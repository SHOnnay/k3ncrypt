package com.k3ncrypt.messaging

import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/** Stable local envelope correlation ID; it authenticates neither sender nor delivery receipt. */
object EnvelopeIdentity {
    private val domain = "k3ncrypt/envelope-id/v1".encodeToByteArray()

    fun create(conversationId: String, olmMessage: String): String {
        val conversation = strictUtf8(conversationId, "Conversation identifier")
        val ciphertext = strictUtf8(olmMessage, "Ciphertext")
        val bytes = ByteArrayOutputStream(domain.size + 8 + conversation.size + ciphertext.size)
        bytes.write(domain)
        writeU32(bytes, conversation.size)
        bytes.write(conversation)
        writeU32(bytes, ciphertext.size)
        bytes.write(ciphertext)
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray())
        return "v1:" + digest.joinToString("") { "%02x".format(it) }
    }

    private fun strictUtf8(value: String, field: String): ByteArray {
        var index = 0
        while (index < value.length) {
            val character = value[index]
            if (Character.isHighSurrogate(character)) {
                require(index + 1 < value.length && Character.isLowSurrogate(value[index + 1])) { "$field is not valid Unicode." }
                index += 2
            } else {
                require(!Character.isLowSurrogate(character)) { "$field is not valid Unicode." }
                index += 1
            }
        }
        return value.encodeToByteArray()
    }

    private fun writeU32(output: ByteArrayOutputStream, length: Int) {
        require(length >= 0) { "Envelope identity input is too large." }
        val value = length.toLong()
        require(value <= 0xffff_ffffL) { "Envelope identity input is too large." }
        output.write(((value ushr 24) and 0xff).toInt())
        output.write(((value ushr 16) and 0xff).toInt())
        output.write(((value ushr 8) and 0xff).toInt())
        output.write((value and 0xff).toInt())
    }
}
