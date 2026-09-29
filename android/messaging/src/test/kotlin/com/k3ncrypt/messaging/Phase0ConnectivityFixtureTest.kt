package com.k3ncrypt.messaging

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Reads the same proposed fixtures as the TypeScript suite; production behavior is unchanged. */
class Phase0ConnectivityFixtureTest {
    @Test fun `shared envelope identity vectors retain cross-platform shape`() {
        val fixture = sharedFixture("envelope-identity.json")
        assertEquals(1, fixture.getInt("version"))
        assertEquals("k3ncrypt/envelope-id/v1", fixture.getString("domain"))
        val vectors = fixture.getJSONArray("vectors")
        assertEquals(3, vectors.length())
        for (index in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(index)
            assertTrue(vector.getString("conversationId").isNotEmpty())
            assertTrue(vector.getString("olmMessage").isNotEmpty())
            assertTrue(vector.getString("expectedHex").matches(Regex("[0-9a-f]{64}")))
        }
        assertEquals(vectors.getJSONObject(0).getString("olmMessage"), vectors.getJSONObject(2).getString("olmMessage"))
        assertFalse(vectors.getJSONObject(0).getString("expectedHex") == vectors.getJSONObject(2).getString("expectedHex"))
    }

    @Test fun `shared path gate table has a single eligible case`() {
        val fixture = sharedFixture("path-eligibility.json")
        assertEquals(1, fixture.getInt("version"))
        val cases = fixture.getJSONArray("cases")
        assertEquals(6, cases.length())
        for (index in 0 until cases.length()) {
            val item = cases.getJSONObject(index)
            val eligible = item.getBoolean("verified") && item.getBoolean("identityUnchanged") &&
                item.getBoolean("deviceAuthorized") && item.getBoolean("freshnessValid") && item.getBoolean("featureNegotiated")
            assertEquals(item.getString("name"), eligible, item.getBoolean("eligible"))
        }
    }

    @Test fun `unknown frame version and channel are rejected by current Android decoder`() {
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
            MessageFrame.decodeText(byteArrayOf(2, 1, 0x68))
        }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
            MessageFrame.decodeText(byteArrayOf(1, 3, 0x68))
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
