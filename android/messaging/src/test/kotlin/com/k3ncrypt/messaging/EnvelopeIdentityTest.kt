package com.k3ncrypt.messaging

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

class EnvelopeIdentityTest {
    private fun fixture(): JSONObject {
        var directory = File(System.getProperty("user.dir")).canonicalFile
        repeat(8) {
            val candidate = File(directory, "protocol-fixtures/v1/envelope-identity.json")
            if (candidate.isFile) return JSONObject(candidate.readText())
            directory = directory.parentFile ?: return@repeat
        }
        error("Shared envelope-identity fixture was not found from the Gradle test directory.")
    }

    @Test fun `matches the shared TypeScript fixture exactly`() {
        val vectors = fixture().getJSONArray("vectors")
        for (index in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(index)
            assertEquals("v1:${vector.getString("expectedHex")}", EnvelopeIdentity.create(vector.getString("conversationId"), vector.getString("olmMessage")))
        }
    }

    @Test fun `binds exact ciphertext to conversation and supports long input`() {
        val original = EnvelopeIdentity.create("room-a", "ciphertext")
        assertNotEquals(original, EnvelopeIdentity.create("room-b", "ciphertext"))
        assertNotEquals(original, EnvelopeIdentity.create("room-a", "ciphertext changed"))
        assertEquals(original, EnvelopeIdentity.create("room-a", "ciphertext"))
        assertTrue(EnvelopeIdentity.create("long-room", "x".repeat(192 * 1024)).matches(Regex("^v1:[0-9a-f]{64}$")))
    }

    @Test fun `rejects malformed UTF-16 instead of replacing it`() {
        try {
            EnvelopeIdentity.create("room", "\uD800")
            fail("Expected malformed UTF-16 to be rejected")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message!!.contains("valid Unicode"))
        }
    }
}
