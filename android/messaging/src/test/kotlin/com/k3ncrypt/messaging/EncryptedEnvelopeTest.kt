package com.k3ncrypt.messaging

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.json.JSONObject
import java.io.File

class EncryptedEnvelopeTest {
    @Test fun `valid modern envelope is accepted`() { assertEquals("wire", EncryptedEnvelopeParser.parse("{\"version\":2,\"strategy\":\"vodozemac-olm-v1\",\"data\":{\"version\":1,\"olmMessage\":\"wire\"}}").olmMessage) }
    @Test fun `extra envelope fields are rejected`() { assertThrows(IllegalArgumentException::class.java) { EncryptedEnvelopeParser.parse("{\"version\":2,\"strategy\":\"vodozemac-olm-v1\",\"data\":{\"version\":1,\"olmMessage\":\"wire\"},\"x\":1}") } }
    @Test fun `pre-key routing metadata is recognized without decrypting`() {
        val wire = "{\"version\":1,\"message_type\":0,\"ciphertext\":\"opaque\"}"
        val envelope = JSONObject().put("version", 2).put("strategy", "vodozemac-olm-v1")
            .put("data", JSONObject().put("version", 1).put("olmMessage", wire)).toString()
        assertEquals(true, EncryptedEnvelopeParser.parse(envelope).isPreKeyMessage)
    }

    @Test fun `browser shared encrypted envelope fixture parses without schema translation`() {
        val fixture = sharedFixture("encrypted-envelopes.json")
        val serialized = fixture.getJSONObject("accepted").getString("serialized")
        val parsed = EncryptedEnvelopeParser.parse(serialized)
        assertEquals(JSONObject(serialized).getJSONObject("data").getString("olmMessage"), parsed.olmMessage)
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
