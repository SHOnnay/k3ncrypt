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
        var directory: File? = File(System.getProperty("user.dir"))
        repeat(8) {
            val candidate = directory?.resolve("protocol-fixtures/v1/$name")
            if (candidate?.isFile == true) return JSONObject(candidate.readText())
            directory = directory?.parentFile
        }
        error("Shared protocol fixture not found: $name")
    }
}
