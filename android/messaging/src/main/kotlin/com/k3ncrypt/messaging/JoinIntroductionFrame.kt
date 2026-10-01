package com.k3ncrypt.messaging

import org.json.JSONObject

/** Byte-compatible with Web join-introduction-v1. This frame carries contact setup, never trust. */
data class JoinIntroduction(val version: Int, val eventId: String, val conversationId: String, val senderAddress: String, val identityCommitment: String, val createdAt: Long, val signature: String)

object JoinIntroductionFrame {
    private val magic = byteArrayOf(0, 0x4b, 0x33, 0x4e, 0x43, 0x49, 1)
    private val uuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
    private val fingerprint = Regex("^K3 [A-Z0-9_ -]{20,128}$")
    private val signaturePattern = Regex("^[A-Za-z0-9_-]{86}$")

    fun isIntroduction(payload: ByteArray): Boolean = payload.size >= magic.size && magic.indices.all { payload[it] == magic[it] }

    fun parse(payload: ByteArray): JoinIntroduction? {
        if (!isIntroduction(payload)) return null
        require(payload.size <= 2_055) { "Join introduction is oversized" }
        val json = JSONObject(payload.copyOfRange(magic.size, payload.size).decodeToString(throwOnInvalidSequence = true))
        val expected = setOf("version", "type", "eventId", "conversationId", "senderAddress", "identityCommitment", "createdAt", "signature")
        require(json.keys().asSequence().toSet() == expected) { "Join introduction fields are invalid" }
        require(json.getInt("version") == 1 && json.getString("type") == "join-introduction") { "Join introduction version is unsupported" }
        val event = JoinIntroduction(1, json.getString("eventId"), json.getString("conversationId"), json.getString("senderAddress"), json.getString("identityCommitment"), json.getLong("createdAt"), json.getString("signature"))
        require(uuid.matches(event.eventId) && uuid.matches(event.conversationId) && uuid.matches(event.senderAddress)) { "Join introduction identifier is invalid" }
        require(fingerprint.matches(event.identityCommitment) && event.createdAt > 0 && signaturePattern.matches(event.signature)) { "Join introduction content is invalid" }
        return event
    }

    /** Exact UTF-8 compact JSON field ordering used by Web when signing the unsigned event. */
    fun canonicalPayload(event: JoinIntroduction): ByteArray =
        "{\"version\":1,\"type\":\"join-introduction\",\"eventId\":${JSONObject.quote(event.eventId)},\"conversationId\":${JSONObject.quote(event.conversationId)},\"senderAddress\":${JSONObject.quote(event.senderAddress)},\"identityCommitment\":${JSONObject.quote(event.identityCommitment)},\"createdAt\":${event.createdAt}}".encodeToByteArray()

    fun encode(event: JoinIntroduction): ByteArray {
        val body = "{\"version\":1,\"type\":\"join-introduction\",\"eventId\":${JSONObject.quote(event.eventId)},\"conversationId\":${JSONObject.quote(event.conversationId)},\"senderAddress\":${JSONObject.quote(event.senderAddress)},\"identityCommitment\":${JSONObject.quote(event.identityCommitment)},\"createdAt\":${event.createdAt},\"signature\":${JSONObject.quote(event.signature)}}".encodeToByteArray()
        return magic + body
    }
}
