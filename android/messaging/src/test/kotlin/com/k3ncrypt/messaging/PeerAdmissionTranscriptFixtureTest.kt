package com.k3ncrypt.messaging

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.charset.CodingErrorAction

/** Independent unsigned encoding projection in test source only; no admission runtime. */
class PeerAdmissionTranscriptFixtureTest {
    private fun fixture(): JSONObject {
        var directory = File(System.getProperty("user.dir") ?: error("Test working directory unavailable")).canonicalFile
        repeat(8) {
            val candidate = File(directory, "protocol-fixtures/v1/peer-admission-transcript-review.json")
            if (candidate.isFile) return JSONObject(candidate.readText())
            directory = directory.parentFile ?: return@repeat
        }
        error("Review fixture not found")
    }
    private fun lp(bytes: ByteArray): ByteArray = ByteArrayOutputStream().also { out ->
        DataOutputStream(out).use { it.writeInt(bytes.size); it.write(bytes) }
    }.toByteArray()
    private fun text(value: String): ByteArray {
        val buffer = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(value))
        return lp(ByteArray(buffer.remaining()).also { buffer.get(it) })
    }
    private fun hex(value: String): ByteArray {
        require(value.matches(Regex("(?:[0-9a-f]{2})+"))) { "Invalid hex" }
        return lp(value.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
    }
    private fun versions(values: JSONArray): ByteArray = ByteArrayOutputStream().also { out ->
        require(values.length() > 0)
        DataOutputStream(out).use { writer ->
            writer.writeInt(values.length())
            var prior = 0L
            for (i in 0 until values.length()) {
                val current = values.getLong(i)
                require(current > prior && current <= 0xffffffffL) { "Noncanonical list" }
                writer.writeInt(current.toInt()); prior = current
            }
        }
    }.toByteArray()
    private fun encode(value: JSONObject, role: String): ByteArray = ByteArrayOutputStream().also { out ->
        DataOutputStream(out).use { writer ->
            writer.write(text("k3ncrypt/peer-admission/v1")); writer.writeInt(1); writer.write(text(role))
            for (key in listOf("conversationId", "initiatorDeviceId", "initiatorIdentityReference",
                "responderDeviceId", "responderIdentityReference")) writer.write(text(value.getString(key)))
            writer.write(text("initiator")); writer.write(text("responder"))
            writer.write(hex(value.getString("initiatorNonceHex"))); writer.write(hex(value.getString("responderNonceHex")))
            writer.write(versions(value.getJSONArray("initiatorOfferedControlVersions")))
            writer.write(versions(value.getJSONArray("responderOfferedControlVersions")))
            val selected = value.getLong("selectedControlVersion")
            require(selected in 0..0xffffffffL)
            writer.writeInt(selected.toInt()); writer.write(text(value.getString("downgradeOutcome")))
            val binding = value.getJSONObject("transportBinding")
            writer.write(lp(text(binding.getString("kind")) + text(binding.getString("fingerprintAlgorithm")) +
                hex(binding.getString("initiatorFingerprintHex")) + hex(binding.getString("responderFingerprintHex"))))
        }
    }.toByteArray()
    private fun toHex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    @Test fun matchesEveryFrozenUnsignedRoleProjection() {
        val shared = fixture()
        assertEquals("REVIEW_ONLY_NOT_APPROVED", shared.getString("status"))
        assertFalse(shared.getBoolean("productionEligible"))
        assertTrue(shared.isNull("signatureOutputs"))
        val vectors = shared.getJSONArray("vectors")
        val baseline = vectors.getJSONObject(0).getString("initiatorPayloadHex")
        for (i in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(i)
            assertEquals(vector.getString("name"), vector.getString("initiatorPayloadHex"), toHex(encode(vector.getJSONObject("input"), "initiator")))
            assertEquals(vector.getString("name"), vector.getString("responderPayloadHex"), toHex(encode(vector.getJSONObject("input"), "responder")))
            assertNotEquals(vector.getString("initiatorPayloadHex"), vector.getString("responderPayloadHex"))
            if (i > 0) assertNotEquals(baseline, vector.getString("initiatorPayloadHex"))
        }
    }
    @Test fun rejectsAmbiguousUnsignedFramingInputs() {
        for (bad in listOf("\uD800", "\uDC00")) {
            try { text(bad); fail("Malformed Unicode was replaced") } catch (_: java.nio.charset.CharacterCodingException) { }
        }
        try { hex("a"); fail("Odd hex accepted") } catch (_: IllegalArgumentException) { }
        for (bad in listOf("[2,1]", "[1,1]")) {
            try { versions(JSONArray(bad)); fail("Ambiguous list accepted") } catch (_: IllegalArgumentException) { }
        }
    }
}
