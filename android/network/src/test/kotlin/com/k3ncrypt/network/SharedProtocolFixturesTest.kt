package com.k3ncrypt.network

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

class SharedProtocolFixturesTest {
    @Test fun `native Vodozemac input uses standard base64 for base64url protocol keys`() {
        val bytes = ByteArray(32) { 0xff.toByte() }
        val protocolKey = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        val expectedNativeKey = Base64.getEncoder().withoutPadding().encodeToString(bytes)

        assertTrue(protocolKey.contains('_'))
        assertTrue(expectedNativeKey.contains('/'))
        assertEquals(expectedNativeKey, VodozemacBundleCodec.toNativeBase64(protocolKey))
    }

    @Test fun `Android canonical proof request bytes verify against shared server signature`() {
        val fixture = sharedFixture("control-signatures.json")
        val accepted = fixture.getJSONObject("accepted")
        val expectedBytes = accepted.getString("canonicalPayload")
        val request = JSONObject(expectedBytes)
        val androidBytes = CanonicalJson.objectOf(listOf(
            "version" to request.getInt("version"),
            "requestId" to request.getString("requestId"),
            "accountIdentityReference" to request.getString("accountIdentityReference"),
            "deviceId" to request.getString("deviceId"),
            "deviceIdentityReference" to request.getString("deviceIdentityReference"),
            "operation" to request.getString("operation"),
            "nonce" to request.getString("nonce"),
            "epoch" to request.getLong("epoch"),
            "createdAt" to request.getLong("createdAt"),
            "expiresAt" to request.getLong("expiresAt"),
        ))

        assertEquals(expectedBytes, androidBytes)
        assertTrue(verify(fixture.getString("syntheticEd25519PublicKey"), accepted.getString("signature"), androidBytes))
        assertFalse(verify(fixture.getString("syntheticEd25519PublicKey"), accepted.getString("signature"), fixture.getJSONObject("modifiedField").getString("canonicalPayload")))
    }

    @Test fun `proof fixture resource scope and expiry contract are explicit`() {
        val fixture = sharedFixture("device-proof-requests.json")
        val accepted = fixture.getJSONObject("accepted")
        assertEquals("relay:message", accepted.getString("operation"))
        assertEquals(4L, accepted.getLong("epoch"))
        assertEquals("33333333-3333-4333-8333-333333333333", accepted.getJSONObject("resource").getString("conversationId"))
        assertFalse(fixture.getJSONObject("expiredProof").getBoolean("accepted"))
        assertFalse(fixture.getJSONObject("replayedRequest").getBoolean("accepted"))
        assertFalse(fixture.getJSONObject("wrongResource").getBoolean("accepted"))
    }

    @Test fun `signed lifecycle wire body preserves canonical fields and appends signature`() {
        val accepted = sharedFixture("control-signatures.json").getJSONObject("accepted")
        val wire = signedControlWireJson(accepted.getString("canonicalPayload"), accepted.getString("signature"))
        assertTrue(wire.startsWith(accepted.getString("canonicalPayload").dropLast(1)))
        assertTrue(wire.endsWith("\"signature\":${JSONObject.quote(accepted.getString("signature"))}}"))
        assertTrue(verify(sharedFixture("control-signatures.json").getString("syntheticEd25519PublicKey"), accepted.getString("signature"), accepted.getString("canonicalPayload")))
    }

    @Test fun `bootstrap enrollment and activation signatures match shared cross platform vectors`() {
        val fixture = sharedFixture("device-lifecycle-events.json")
        listOf("bootstrap", "enrollment", "activation").forEach { name ->
            val event = fixture.getJSONObject(name)
            val canonical = event.getString("canonicalPayload")
            val signature = event.getString("signature")
            assertTrue(verify(fixture.getString("publicVerificationKey"), signature, canonical))
            val altered = canonical.replaceFirst("1700000000000", "1700000000001")
            assertFalse(verify(fixture.getString("publicVerificationKey"), signature, altered))
            assertEquals(canonical.dropLast(1) + ",\"signature\":${JSONObject.quote(signature)}}", signedControlWireJson(canonical, signature))
        }
    }

    private fun verify(publicKey: String, signature: String, payload: String): Boolean {
        val prefix = byteArrayOf(0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00)
        val rawKey = Base64.getUrlDecoder().decode(publicKey)
        val key = KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(prefix + rawKey))
        return Signature.getInstance("Ed25519").run {
            initVerify(key)
            update(payload.toByteArray(Charsets.UTF_8))
            verify(Base64.getUrlDecoder().decode(signature))
        }
    }

    private fun sharedFixture(name: String): JSONObject {
        var directory: File? = File(System.getProperty("user.dir") ?: ".")
        repeat(8) {
            val candidate = directory?.resolve("protocol-fixtures/v1/$name")
            if (candidate?.isFile == true) return JSONObject(candidate.readText())
            directory = directory?.parentFile
        }
        error("Shared protocol fixture not found: $name")
    }
}
