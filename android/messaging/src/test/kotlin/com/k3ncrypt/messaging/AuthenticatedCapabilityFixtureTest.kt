package com.k3ncrypt.messaging

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.charset.CodingErrorAction

/** Independent unsigned test-only projection; not a wire parser or admission runtime. */
class AuthenticatedCapabilityFixtureTest {
    private fun fixture(): JSONObject {
        var directory = File(System.getProperty("user.dir") ?: error("Working directory unavailable")).canonicalFile
        repeat(8) {
            val candidate = File(directory, "protocol-fixtures/v1/authenticated-capability-review.json")
            if (candidate.isFile) return JSONObject(candidate.readText())
            directory = directory.parentFile ?: return@repeat
        }
        error("Fixture missing")
    }
    private fun bytes(block: (DataOutputStream) -> Unit): ByteArray = ByteArrayOutputStream().also { out -> DataOutputStream(out).use(block) }.toByteArray()
    private fun u32(n: Long): ByteArray { require(n in 0..0xffffffffL); return bytes { it.writeInt(n.toInt()) } }
    private fun lp(b: ByteArray) = u32(b.size.toLong()) + b
    private fun text(s: String): ByteArray {
        val buffer = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(s))
        return lp(ByteArray(buffer.remaining()).also { buffer.get(it) })
    }
    private fun hex(s: String): ByteArray { require(s.matches(Regex("(?:[0-9a-f]{2})+"))); return lp(s.chunked(2).map { it.toInt(16).toByte() }.toByteArray()) }
    private fun strings(a: JSONArray): List<String> = (0 until a.length()).map { a.getString(it) }
    private fun objects(a: JSONArray): List<JSONObject> = (0 until a.length()).map { a.getJSONObject(it) }
    private fun identifier(s: String): String { require(s.matches(Regex("[a-z0-9/-]+"))); return s }
    private fun <T> unique(a: List<T>): List<T> { require(a.toSet().size == a.size); return a }
    private fun integer(value: Any): Long {
        require(value is Int || value is Long) { "Integer required" }
        return (value as Number).toLong()
    }
    private fun versions(a: JSONArray): ByteArray {
        val values = unique((0 until a.length()).map { integer(a.get(it)) }).sorted()
        require(values.isNotEmpty() && values.all { it in 1..0xffffffffL })
        return bytes { writer -> writer.write(u32(values.size.toLong())); for (v in values) writer.write(u32(v)) }
    }
    private fun hasVersion(a: JSONArray, n: Long) = (0 until a.length()).any { integer(a.get(it)) == n }
    private fun exact(o: JSONObject, keys: Set<String>) { require(o.keys().asSequence().toSet() == keys) }
    private fun offer(o: JSONObject): ByteArray {
        exact(o, setOf("offerVersion", "admissionVersions", "negotiationVersions", "controlVersions", "capabilities", "requiredIds"))
        require(integer(o.get("offerVersion")) == 1L)
        val caps = objects(o.getJSONArray("capabilities")).sortedBy { it.getString("id") }
        val ids = unique(caps.map { identifier(it.getString("id")) })
        val required = unique(strings(o.getJSONArray("requiredIds")).map { identifier(it) }).sorted()
        require(required.all { it in ids })
        for (c in caps) exact(c, setOf("id", "versions"))
        return bytes { writer ->
            writer.write(u32(1)); for (k in listOf("admissionVersions", "negotiationVersions", "controlVersions")) writer.write(versions(o.getJSONArray(k)))
            writer.write(u32(caps.size.toLong()))
            for (c in caps) { writer.write(text(c.getString("id"))); writer.write(versions(c.getJSONArray("versions"))) }
            writer.write(u32(required.size.toLong())); for (i in required) writer.write(text(i))
        }
    }
    private data class Selection(val control: Long, val capabilities: List<Pair<String, Long>>)
    private fun select(a: JSONObject, b: JSONObject, profile: JSONObject): Selection {
        offer(a); offer(b)
        require(listOf(a, b).all { hasVersion(it.getJSONArray("admissionVersions"), 1) && hasVersion(it.getJSONArray("negotiationVersions"), 1) }) { "BOOTSTRAP" }
        val known = strings(profile.getJSONArray("requiredIds"))
        require((strings(a.getJSONArray("requiredIds")) + strings(b.getJSONArray("requiredIds"))).all { it in known }) { "UNKNOWN_REQUIRED" }
        val preferences = profile.getJSONArray("controlPreference")
        val selected = (0 until preferences.length()).map { integer(preferences.get(it)) }.firstOrNull { n -> listOf(a, b).all { hasVersion(it.getJSONArray("controlVersions"), n) } } ?: error("NO_COMMON")
        val caps = known.map { id ->
            require(listOf(a, b).all { o -> objects(o.getJSONArray("capabilities")).any { c -> c.getString("id") == id && hasVersion(c.getJSONArray("versions"), 1) } }) { "NO_COMMON" }
            id to 1L
        }
        return Selection(selected, caps)
    }
    private fun selected(x: JSONObject) = objects(x.getJSONArray("selectedCapabilities")).map { it.getString("id") to integer(it.get("version")) }
    private fun encode(x: JSONObject, role: String): ByteArray {
        require(role in listOf("initiator", "responder"))
        val caps = selected(x).sortedBy { it.first }; unique(caps.map { identifier(it.first) })
        return bytes { writer ->
            writer.write(text("k3ncrypt/peer-admission/a1-review")); writer.write(u32(1)); writer.write(text(role))
            for (key in listOf("preferenceProfileId", "conversationId", "initiatorDeviceId", "initiatorIdentityReference", "responderDeviceId", "responderIdentityReference")) writer.write(text(x.getString(key)))
            writer.write(text("initiator")); writer.write(text("responder")); writer.write(hex(x.getString("initiatorNonceHex"))); writer.write(hex(x.getString("responderNonceHex")))
            writer.write(lp(offer(x.getJSONObject("initiatorOffer")))); writer.write(lp(offer(x.getJSONObject("responderOffer"))))
            writer.write(u32(integer(x.get("selectedControlVersion")))); writer.write(u32(caps.size.toLong()))
            for ((id, version) in caps) { writer.write(text(id)); writer.write(u32(version)) }
            writer.write(hex(x.getString("transportBindingHex")))
        }
    }
    private fun toHex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    private fun evaluate(x: JSONObject, base: JSONObject, profile: JSONObject): String {
        val context = listOf("preferenceProfileId", "conversationId", "initiatorDeviceId", "initiatorIdentityReference", "responderDeviceId", "responderIdentityReference", "initiatorNonceHex", "responderNonceHex", "transportBindingHex")
        if (context.any { x.getString(it) != base.getString(it) }) return "CONTEXT_MISMATCH"
        if (!offer(x.getJSONObject("initiatorOffer")).contentEquals(offer(base.getJSONObject("initiatorOffer")))) return "OWN_OFFER_MISMATCH"
        return try {
            val result = select(x.getJSONObject("initiatorOffer"), x.getJSONObject("responderOffer"), profile)
            if (result.control == integer(x.get("selectedControlVersion")) && result.capabilities == selected(x)) "ACCEPT" else "RESULT_MISMATCH"
        } catch (e: IllegalArgumentException) { e.message ?: error("Missing reason") } catch (e: IllegalStateException) { e.message ?: error("Missing reason") }
    }
    @Test fun frozenBothRoleBytesAndExpectedLocalChecks() {
        val f = fixture(); val vectors = f.getJSONArray("vectors"); val base = vectors.getJSONObject(0).getJSONObject("input"); val profile = f.getJSONObject("profile")
        assertEquals("REVIEW_ONLY_NOT_APPROVED", f.getString("status")); assertFalse(f.getBoolean("productionEligible")); assertTrue(f.isNull("signatureOutputs"))
        val baseline = vectors.getJSONObject(0).getString("initiatorPayloadHex")
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i); val x = v.getJSONObject("input")
            assertEquals(v.getString("name"), v.getString("initiatorPayloadHex"), toHex(encode(x, "initiator")))
            assertEquals(v.getString("name"), v.getString("responderPayloadHex"), toHex(encode(x, "responder")))
            assertNotEquals(v.getString("initiatorPayloadHex"), v.getString("responderPayloadHex"))
            assertEquals(v.getString("name"), v.getString("expectedOutcome"), evaluate(x, base, profile))
            if (v.getBoolean("canonicalEquivalentToBaseline")) assertEquals(baseline, v.getString("initiatorPayloadHex")) else if (i > 0) assertNotEquals(baseline, v.getString("initiatorPayloadHex"))
            if (v.getString("expectedOutcome") == "ACCEPT") {
                assertEquals(select(x.getJSONObject("initiatorOffer"), x.getJSONObject("responderOffer"), profile), select(x.getJSONObject("responderOffer"), x.getJSONObject("initiatorOffer"), profile))
            }
        }
        assertEquals(1L, select(base.getJSONObject("initiatorOffer"), base.getJSONObject("responderOffer"), profile).control)
    }
    @Test fun rejectsDuplicatesMalformedSchemaAndMissingPrerequisites() {
        val f = fixture(); val base = f.getJSONArray("vectors").getJSONObject(0).getJSONObject("input")
        val mutations: List<(JSONObject) -> Unit> = listOf(
            { it.getJSONArray("controlVersions").put(1) },
            { it.getJSONArray("capabilities").put(it.getJSONArray("capabilities").getJSONObject(0)) },
            { it.getJSONArray("requiredIds").put(it.getJSONArray("requiredIds").getString(0)) },
            { it.put("offerVersion", 2) }, { it.put("unknown", true) },
            { it.getJSONArray("capabilities").getJSONObject(0).put("id", "UPPER") },
            { it.put("controlVersions", JSONArray("[1.5]")) }, { it.put("controlVersions", JSONArray("[0]")) },
            { it.put("controlVersions", JSONArray("[4294967296]")) }, { it.put("controlVersions", JSONArray()) },
            { it.getJSONArray("capabilities").remove(0) },
        )
        for (mutate in mutations) {
            val o = JSONObject(base.getJSONObject("initiatorOffer").toString()); mutate(o)
            try { offer(o); fail("Malformed offer accepted") } catch (_: IllegalArgumentException) { }
        }
        val o = JSONObject(base.getJSONObject("initiatorOffer").toString()); o.put("admissionVersions", JSONArray("[2]"))
        try { select(o, base.getJSONObject("responderOffer"), f.getJSONObject("profile")); fail("Bootstrap accepted") } catch (e: IllegalArgumentException) { assertEquals("BOOTSTRAP", e.message) }
        for (bad in listOf("\uD800", "\uDC00")) try { text(bad); fail("Unicode replaced") } catch (_: java.nio.charset.CharacterCodingException) { }
        try { hex("f"); fail("Odd hex accepted") } catch (_: IllegalArgumentException) { }
        try { u32(-1); fail("Invalid integer accepted") } catch (_: IllegalArgumentException) { }
    }
    @Test fun unknownOptionalRetainedWithoutSelection() {
        val f = fixture(); val vectors = objects(f.getJSONArray("vectors")); val base = vectors.first().getJSONObject("input")
        val x = vectors.first { it.getString("name") == "unknown-optional-retained-disabled" }.getJSONObject("input")
        assertFalse(offer(x.getJSONObject("responderOffer")).contentEquals(offer(base.getJSONObject("responderOffer"))))
        assertFalse(select(x.getJSONObject("initiatorOffer"), x.getJSONObject("responderOffer"), f.getJSONObject("profile")).capabilities.any { it.first == "future/unknown" })
    }
}
