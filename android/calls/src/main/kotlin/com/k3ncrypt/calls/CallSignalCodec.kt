package com.k3ncrypt.calls

import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

data class CallSignalValue(
    val callId: String,
    val conversationId: String,
    val senderParticipantId: String,
    val senderIdentityId: String,
    val receiverIdentityId: String,
    val mediaMode: String,
    val nonce: String,
    val event: String,
    val kind: String,
    val payload: JSONObject?,
    val sequence: Long,
    val timestamp: Long,
    val expiresAt: Long,
    val identityBinding: String,
    val payloadDigest: String,
)

/** Mirrors service/src/calls/signalBinding.ts. Olm encryption authenticates the wire; digest binds the decoded call fields. */
object CallSignalCodec {
    data class DigestInputDiagnostic(val kind: String, val byteLength: Int, val payloadJsonLength: Int, val sdpValueLength: Int, val metadataLength: Int, val escapingCategory: String)
    @Volatile private var digestDiagnosticSink: ((DigestInputDiagnostic) -> Unit)? = null

    fun installDebugDigestDiagnosticSink(sink: (DigestInputDiagnostic) -> Unit) {
        digestDiagnosticSink = if (BuildConfig.DEBUG) sink else null
    }

    fun binding(conversationId: String, leftParticipant: String, leftIdentity: String, rightParticipant: String, rightIdentity: String): String {
        val parties = listOf(leftParticipant to leftIdentity, rightParticipant to rightIdentity).sortedBy { it.second }
        return sha256("k3ncrypt:call-binding:v1\u0000$conversationId\u0000" + parties.joinToString("|") { "${it.first}:${it.second}" })
    }

    fun create(
        callId: String, conversationId: String, senderParticipantId: String, senderIdentityId: String,
        receiverIdentityId: String, mediaMode: String, event: String, kind: String = "control",
        payload: JSONObject? = null, sequence: Long, timestamp: Long, expiresAt: Long, identityBinding: String,
        nonce: String = UUID.randomUUID().toString(),
    ): CallSignalValue {
        val unsigned = CallSignalValue(callId, conversationId, senderParticipantId, senderIdentityId, receiverIdentityId, mediaMode, nonce, event, kind, payload, sequence, timestamp, expiresAt, identityBinding, "")
        val canonicalInput = canonical(unsigned)
        val digestInput = canonicalInput.toByteArray(Charsets.UTF_8)
        if (BuildConfig.DEBUG) {
            val payloadJsonLength = (payload?.let(::stableJson) ?: "null").toByteArray(Charsets.UTF_8).size
            val sdpValueLength = payload?.optString("sdp")?.toByteArray(Charsets.UTF_8)?.size ?: 0
            digestDiagnosticSink?.invoke(DigestInputDiagnostic(kind, digestInput.size, payloadJsonLength, sdpValueLength, digestInput.size - payloadJsonLength, escapingCategory(unsigned)))
        }
        return unsigned.copy(payloadDigest = sha256(canonicalInput))
    }

    fun encode(signal: CallSignalValue): String {
        require(validate(signal, signal.conversationId, signal.receiverIdentityId, System.currentTimeMillis()))
        // Legacy wire value is compatibility metadata; admission uses the receiver's local authority.
        val sender = "{\"participantId\":${JSONObject.quote(signal.senderParticipantId)},\"identityId\":${JSONObject.quote(signal.senderIdentityId)},\"verification\":\"verified\"}"
        return buildString {
            append('{')
            append("\"callId\":${JSONObject.quote(signal.callId)},\"conversationId\":${JSONObject.quote(signal.conversationId)},\"sender\":$sender,")
            append("\"receiverIdentityId\":${JSONObject.quote(signal.receiverIdentityId)},\"mediaMode\":${JSONObject.quote(signal.mediaMode)},\"nonce\":${JSONObject.quote(signal.nonce)},")
            append("\"event\":${JSONObject.quote(signal.event)},\"kind\":${JSONObject.quote(signal.kind)},")
            signal.payload?.let { append("\"payload\":$it,") }
            append("\"sequence\":${signal.sequence},\"timestamp\":${signal.timestamp},\"expiresAt\":${signal.expiresAt},")
            append("\"identityBinding\":${JSONObject.quote(signal.identityBinding)},\"payloadDigest\":${JSONObject.quote(signal.payloadDigest)}}")
        }
    }

    fun decode(json: String): CallSignalValue {
        require(json.length in 1..65_536)
        val value = JSONObject(json)
        val sender = value.getJSONObject("sender")
        fun requiredString(source: JSONObject, key: String): String = (source.get(key) as? String)
            ?.takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("Invalid call signal field: $key")
        fun requiredLong(key: String): Long = when (val raw = value.get(key)) {
            is Int -> raw.toLong()
            is Long -> raw
            else -> throw IllegalArgumentException("Invalid call signal field: $key")
        }
        require(requiredString(sender, "verification") == "verified")
        val kind = if (value.has("kind")) requiredString(value, "kind") else "control"
        val payload = if (value.has("payload")) value.get("payload") as? JSONObject
            ?: throw IllegalArgumentException("Invalid call signal payload") else null
        require(kind == "control" || payload != null) { "Missing call signal payload" }
        return CallSignalValue(
            requiredString(value, "callId"), requiredString(value, "conversationId"), requiredString(sender, "participantId"), requiredString(sender, "identityId"),
            requiredString(value, "receiverIdentityId"), requiredString(value, "mediaMode"), requiredString(value, "nonce"), requiredString(value, "event"),
            kind, payload, requiredLong("sequence"), requiredLong("timestamp"),
            requiredLong("expiresAt"), requiredString(value, "identityBinding"), requiredString(value, "payloadDigest"),
        )
    }

    fun validate(signal: CallSignalValue, conversationId: String, localIdentityId: String, now: Long): Boolean {
        if (signal.conversationId != conversationId || signal.receiverIdentityId != localIdentityId) return false
        if (signal.mediaMode !in setOf("audio", "video") || signal.event !in setOf("invite", "accept", "reject", "cancel", "connect", "connected", "reconnect", "end", "expire", "fail")) return false
        if (signal.kind !in setOf("control", "offer", "answer", "ice-candidate") || signal.sequence < 1 || signal.timestamp > now + 30_000 || signal.expiresAt <= now || signal.timestamp > signal.expiresAt) return false
        if (runCatching { UUID.fromString(signal.callId) }.isFailure || runCatching { UUID.fromString(signal.nonce) }.isFailure) return false
        if (signal.payloadDigest != sha256(canonical(signal))) return false
        return true
    }

    private fun canonical(value: CallSignalValue): String {
        // Legacy wire value is compatibility metadata; admission uses the receiver's local authority.
        val sender = "{\"participantId\":${canonicalQuote(value.senderParticipantId)},\"identityId\":${canonicalQuote(value.senderIdentityId)},\"verification\":\"verified\"}"
        val payload = value.payload?.let(::stableJson) ?: "null"
        return "{\"callId\":${canonicalQuote(value.callId)},\"conversationId\":${canonicalQuote(value.conversationId)},\"sender\":$sender," +
            "\"receiverIdentityId\":${canonicalQuote(value.receiverIdentityId)},\"mediaMode\":${canonicalQuote(value.mediaMode)},\"nonce\":${canonicalQuote(value.nonce)}," +
            "\"event\":${canonicalQuote(value.event)},\"kind\":${canonicalQuote(value.kind)},\"payload\":$payload," +
            "\"sequence\":${value.sequence},\"timestamp\":${value.timestamp},\"expiresAt\":${value.expiresAt},\"identityBinding\":${canonicalQuote(value.identityBinding)}}"
    }

    private fun stableJson(value: Any): String = when (value) {
        JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(separator = ",", prefix = "{", postfix = "}") { key -> "${canonicalQuote(key)}:${stableJson(value.get(key))}" }
        is org.json.JSONArray -> (0 until value.length()).joinToString(separator = ",", prefix = "[", postfix = "]") { index -> stableJson(value.get(index)) }
        is String -> canonicalQuote(value)
        is Number, is Boolean -> value.toString()
        else -> error("call_signal_payload_invalid")
    }

    /** Mirrors JavaScript JSON.stringify string escaping for the cross-platform digest contract. */
    private fun canonicalQuote(value: String): String = buildString(value.length + 2) {
        append('"')
        value.forEach { character ->
            when (character) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\t' -> append("\\t")
                '\n' -> append("\\n")
                '\u000c' -> append("\\f")
                '\r' -> append("\\r")
                else -> if (character.code < 0x20) append("\\u%04x".format(character.code)) else append(character)
            }
        }
        append('"')
    }

    private fun escapingCategory(signal: CallSignalValue): String {
        val strings = buildList {
            signal.payload?.keys()?.forEach { key ->
                val value = signal.payload.opt(key)
                if (value is String) add(key to value)
            }
        }
        val sdp = strings.firstOrNull { it.first == "sdp" }?.second
        if (sdp != null) {
            if (sdp.contains("\r\n")) return "CRLF-vs-LF"
            if (sdp.contains('\n') || sdp.contains('\r')) return "line-ending-variant"
        }
        if (strings.any { (_, value) -> value.any { it.code in 0x80..0x20ff } }) return "unicode-escape"
        if (strings.any { (_, value) -> '/' in value }) return "slash-escape-case"
        if (strings.any { (_, value) -> value.any { it == '\\' || it == '"' || it.code < 0x20 } }) return "escape-mismatch-candidate"
        return "plain-ascii"
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
