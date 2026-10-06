package com.k3ncrypt.calls

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.UUID

class CallSignalCodecTest {
    @Test fun `decoder rejects malformed security field types`() {
        val now = System.currentTimeMillis()
        val conversation = UUID.randomUUID().toString()
        val signal = CallSignalCodec.create(UUID.randomUUID().toString(), conversation, "route", "sender", "receiver", "audio", "invite", sequence = 1, timestamp = now, expiresAt = now + 30_000, identityBinding = "binding")
        val valid = CallSignalCodec.encode(signal)
        listOf(
            JSONObject(valid).put("callId", 12),
            JSONObject(valid).put("event", true),
            JSONObject(valid).put("timestamp", "123"),
            JSONObject(valid).put("sequence", 1.5),
            JSONObject(valid).put("payload", "invalid string"),
            JSONObject(valid).put("payload", JSONObject.NULL),
            JSONObject(valid).put("sender", JSONObject().put("participantId", 4).put("identityId", "sender").put("verification", "verified")),
        ).forEach { malformed ->
            assertThrows(Exception::class.java) { CallSignalCodec.decode(malformed.toString()) }
        }
    }
    @Test fun `matches TypeScript call binding and digest golden vector`() {
        val conversation = "22222222-2222-4222-8222-222222222222"
        assertTrue(CallSignalCodec.binding(conversation, "route-a", "K3 device-a", "route-b", "K3 device-b") == "487878ef9dafeb9b181c2d5f181163ddc314688d155a70ee15235f75bd2a7281")
        val signal = CallSignalCodec.create(
            callId = "11111111-1111-4111-8111-111111111111", conversationId = conversation,
            senderParticipantId = "route-a", senderIdentityId = "K3 device-a", receiverIdentityId = "K3 device-b",
            mediaMode = "audio", event = "invite", nonce = "33333333-3333-4333-8333-333333333333",
            sequence = 1, timestamp = 1000, expiresAt = 61_000, identityBinding = "binding",
        )
        assertEquals("da87d6d42b886c212d8050d5530d7ececf487989314e2986b1a0cab44622788a", signal.payloadDigest)
        val legacy = CallSignalCodec.create(
            callId = "11111111-1111-4111-8111-111111111111", conversationId = conversation,
            senderParticipantId = "route-a", senderIdentityId = "K3 device-a", receiverIdentityId = "K3 device-b",
            mediaMode = "audio", event = "invite", nonce = "33333333-3333-4333-8333-333333333333",
            sequence = 1, timestamp = 1000, expiresAt = 61_000, identityBinding = "binding", protocolVersion = null,
        )
        assertEquals("90e63d00682e54ccdfabb5b6030d309eb8b44a265686e0f653b4169b86ff7e15", legacy.payloadDigest)
        assertFalse(CallSignalCodec.validate(legacy, conversation, "K3 device-b", 1000))
    }

    @Test fun `signal binds receiver mode conversation and nonce`() {
        val conversation = "11111111-1111-4111-8111-111111111111"
        val now = System.currentTimeMillis()
        val signal = CallSignalCodec.create(UUID.randomUUID().toString(), conversation, "route-a", "K3 device-a", "K3 device-b", "video", "invite", sequence = 1, timestamp = now, expiresAt = now + 30_000, identityBinding = CallSignalCodec.binding(conversation, "route-a", "K3 device-a", "route-b", "K3 device-b"))
        val decoded = CallSignalCodec.decode(CallSignalCodec.encode(signal))
        assertTrue(CallSignalCodec.validate(decoded, conversation, "K3 device-b", now))
        assertFalse(CallSignalCodec.validate(decoded.copy(receiverIdentityId = "K3 other"), conversation, "K3 device-b", now))
        assertFalse(CallSignalCodec.validate(decoded.copy(mediaMode = "data"), conversation, "K3 device-b", now))
        assertFalse(CallSignalCodec.validate(decoded.copy(nonce = UUID.randomUUID().toString()), conversation, "K3 device-b", now))
    }
    @Test fun `signal freshness is bounded independently from a call invitation lifetime`() {
        val conversation = "11111111-1111-4111-8111-111111111111"
        val now = System.currentTimeMillis()
        val binding = CallSignalCodec.binding(conversation, "route-a", "a", "route-b", "b")
        val fresh = CallSignalCodec.create(UUID.randomUUID().toString(), conversation, "route-a", "a", "b", "audio", "connected", "answer", JSONObject().put("type", "answer").put("sdp", "v=0"), sequence = 3, timestamp = now, expiresAt = now + CallSignalCodec.SIGNAL_LIFETIME_MS, identityBinding = binding)
        val staleBound = fresh.copy(expiresAt = now + CallSignalCodec.SIGNAL_LIFETIME_MS + 1)
        assertTrue(CallSignalCodec.validate(fresh, conversation, "b", now))
        assertFalse(CallSignalCodec.validate(staleBound, conversation, "b", now))
    }

    @Test fun `legacy version and future versions are rejected before replay admission`() {
        val conversation = "22222222-2222-4222-8222-222222222222"
        val now = System.currentTimeMillis()
        val current = CallSignalCodec.create(
            callId = "11111111-1111-4111-8111-111111111111", conversationId = conversation,
            senderParticipantId = "route-a", senderIdentityId = "K3 device-a", receiverIdentityId = "K3 device-b",
            mediaMode = "audio", event = "invite", nonce = "33333333-3333-4333-8333-333333333333",
            sequence = 1, timestamp = now, expiresAt = now + 30_000, identityBinding = "binding",
        )
        val wire = JSONObject(CallSignalCodec.encode(current))
        assertThrows(Exception::class.java) { CallSignalCodec.decode(JSONObject(wire.toString()).put("unknownField", true).toString()) }
        val strippedWire = JSONObject(wire.toString()).also { it.remove("protocolVersion") }
        val strippedV2 = CallSignalCodec.decode(strippedWire.toString())
        assertEquals(CallSignalCodec.ProtocolClassification.INVALID, CallSignalCodec.classifyProtocol(strippedV2, conversation, "K3 device-b", now))

        val legacy = CallSignalCodec.create(
            callId = current.callId, conversationId = conversation, senderParticipantId = "route-a", senderIdentityId = "K3 device-a",
            receiverIdentityId = "K3 device-b", mediaMode = "audio", event = "invite", nonce = current.nonce,
            sequence = 1, timestamp = now, expiresAt = now + 30_000, identityBinding = "binding", protocolVersion = null,
        )
        val legacyWire = JSONObject(wire.toString()).also { it.remove("protocolVersion") }.put("payloadDigest", legacy.payloadDigest)
        val decodedLegacy = CallSignalCodec.decode(legacyWire.toString())
        assertEquals(CallSignalCodec.ProtocolClassification.LEGACY, CallSignalCodec.classifyProtocol(decodedLegacy, conversation, "K3 device-b", now))
        assertFalse(CallSignalCodec.validate(decodedLegacy, conversation, "K3 device-b", now))

        val futureSender = JSONObject(wire.getJSONObject("sender").toString()).put("futureSenderField", true)
        val futureWire = JSONObject(wire.toString()).put("protocolVersion", 3).put("sender", futureSender).put("futureField", "ignored-for-rejection").put("payloadDigest", "future-version-digest")
        val future = CallSignalCodec.decode(futureWire.toString())
        assertEquals(CallSignalCodec.ProtocolClassification.UNSUPPORTED, CallSignalCodec.classifyProtocol(future, conversation, "K3 device-b", now))
        val altered = CallSignalCodec.decode(JSONObject(wire.toString()).put("protocolVersion", 3).toString())
        assertEquals(CallSignalCodec.ProtocolClassification.INVALID, CallSignalCodec.classifyProtocol(altered, conversation, "K3 device-b", now))
    }
    @Test fun `payload field order does not change canonical digest`() {
        val conversation = "11111111-1111-4111-8111-111111111111"
        val now = System.currentTimeMillis()
        val payload = JSONObject().put("sdp", "v=0").put("type", "offer")
        val signal = CallSignalCodec.create(UUID.randomUUID().toString(), conversation, "route-a", "a", "b", "audio", "connect", "offer", payload, 2, now, now + 30_000, CallSignalCodec.binding(conversation, "route-a", "a", "route-b", "b"))
        assertTrue(CallSignalCodec.validate(CallSignalCodec.decode(CallSignalCodec.encode(signal)), conversation, "b", now))
    }

    @Test fun `matches TypeScript canonical digest for SDP and ICE payloads`() {
        val conversation = "22222222-2222-4222-8222-222222222222"
        val callId = "11111111-1111-4111-8111-111111111111"
        val nonce = "33333333-3333-4333-8333-333333333333"
        val binding = "binding"
        val sdp = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"
        val offer = CallSignalCodec.create(callId, conversation, "route-a", "K3 device-a", "K3 device-b", "audio", "connect", "offer", JSONObject().put("type", "offer").put("sdp", sdp), 2, 1000, 61_000, binding, nonce)
        assertEquals("ba81d8dc7f38c95ad044f2bacadbfbf6d87fad04f677f934b9fe0332fe90e78b", offer.payloadDigest)
        val legacyOffer = CallSignalCodec.create(callId, conversation, "route-a", "K3 device-a", "K3 device-b", "audio", "connect", "offer", JSONObject().put("type", "offer").put("sdp", sdp), 2, 1000, 61_000, binding, nonce, protocolVersion = null)
        assertEquals("e90ef86c39db5ddb05544835fc6f9eccb2be5ff4a99692d10d3bf35f7f6dfae9", legacyOffer.payloadDigest)
        val realisticSdp = "$sdp" + "a=rtpmap:111 opus/48000/2\r\n"
        val realisticOffer = CallSignalCodec.create(callId, conversation, "route-a", "K3 device-a", "K3 device-b", "audio", "connect", "offer", JSONObject().put("type", "offer").put("sdp", realisticSdp), 2, 1000, 61_000, binding, nonce)
        assertEquals("ceb57c843b64a5bfe1e583ba05264a4ea1c13e6060cad24463834c084c858016", realisticOffer.payloadDigest)

        val ice = CallSignalCodec.create(callId, conversation, "route-a", "K3 device-a", "K3 device-b", "audio", "connect", "ice-candidate", JSONObject().put("candidate", "candidate:1 1 udp 2122260223 192.0.2.1 5000 typ host").put("sdpMLineIndex", 0), 2, 1000, 61_000, binding, nonce)
        assertEquals("3aa64092a1e2ec119be8d62bd28f04160ebd39c141fd3a875ec06c50e5e8fd5f", ice.payloadDigest)
    }

}
