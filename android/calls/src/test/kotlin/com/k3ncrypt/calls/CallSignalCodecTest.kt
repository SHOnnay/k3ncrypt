package com.k3ncrypt.calls

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class CallSignalCodecTest {
    @Test fun `matches TypeScript call binding and digest golden vector`() {
        val conversation = "22222222-2222-4222-8222-222222222222"
        assertTrue(CallSignalCodec.binding(conversation, "route-a", "K3 device-a", "route-b", "K3 device-b") == "487878ef9dafeb9b181c2d5f181163ddc314688d155a70ee15235f75bd2a7281")
        val signal = CallSignalCodec.create(
            callId = "11111111-1111-4111-8111-111111111111", conversationId = conversation,
            senderParticipantId = "route-a", senderIdentityId = "K3 device-a", receiverIdentityId = "K3 device-b",
            mediaMode = "audio", event = "invite", nonce = "33333333-3333-4333-8333-333333333333",
            sequence = 1, timestamp = 1000, expiresAt = 61_000, identityBinding = "binding",
        )
        assertTrue(signal.payloadDigest == "90e63d00682e54ccdfabb5b6030d309eb8b44a265686e0f653b4169b86ff7e15")
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
    @Test fun `payload field order does not change canonical digest`() {
        val conversation = "11111111-1111-4111-8111-111111111111"
        val now = System.currentTimeMillis()
        val payload = JSONObject().put("sdp", "v=0").put("type", "offer")
        val signal = CallSignalCodec.create(UUID.randomUUID().toString(), conversation, "route-a", "a", "b", "audio", "connect", "offer", payload, 2, now, now + 30_000, CallSignalCodec.binding(conversation, "route-a", "a", "route-b", "b"))
        assertTrue(CallSignalCodec.validate(CallSignalCodec.decode(CallSignalCodec.encode(signal)), conversation, "b", now))
    }
}
