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
        return unsigned.copy(payloadDigest = sha256(canonical(unsigned)))
    }

    fun encode(signal: CallSignalValue): String {
        require(validate(signal, signal.conversationId, signal.receiverIdentityId, System.currentTimeMillis()))
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
        require(sender.optString("verification") == "verified")
        return CallSignalValue(
            value.getString("callId"), value.getString("conversationId"), sender.getString("participantId"), sender.getString("identityId"),
            value.getString("receiverIdentityId"), value.getString("mediaMode"), value.getString("nonce"), value.getString("event"),
            value.optString("kind", "control"), value.optJSONObject("payload"), value.getLong("sequence"), value.getLong("timestamp"),
            value.getLong("expiresAt"), value.getString("identityBinding"), value.getString("payloadDigest"),
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
        val sender = "{\"participantId\":${JSONObject.quote(value.senderParticipantId)},\"identityId\":${JSONObject.quote(value.senderIdentityId)},\"verification\":\"verified\"}"
        val payload = value.payload?.let(::stableJson) ?: "null"
        return "{\"callId\":${JSONObject.quote(value.callId)},\"conversationId\":${JSONObject.quote(value.conversationId)},\"sender\":$sender," +
            "\"receiverIdentityId\":${JSONObject.quote(value.receiverIdentityId)},\"mediaMode\":${JSONObject.quote(value.mediaMode)},\"nonce\":${JSONObject.quote(value.nonce)}," +
            "\"event\":${JSONObject.quote(value.event)},\"kind\":${JSONObject.quote(value.kind)},\"payload\":$payload," +
            "\"sequence\":${value.sequence},\"timestamp\":${value.timestamp},\"expiresAt\":${value.expiresAt},\"identityBinding\":${JSONObject.quote(value.identityBinding)}}"
    }

    private fun stableJson(value: Any): String = when (value) {
        JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix = "{", postfix = "}") { key -> "${JSONObject.quote(key)}:${stableJson(value.get(key))}" }
        is org.json.JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { index -> stableJson(value.get(index)) }
        is String -> JSONObject.quote(value)
        is Number, is Boolean -> value.toString()
        else -> error("call_signal_payload_invalid")
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
