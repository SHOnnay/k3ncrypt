package com.k3ncrypt.messaging

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Browser-compatible Vodozemac frame: version byte, channel byte, then strict UTF-8. */
object MessageFrame {
    private fun encode(channel: Byte, text: String): ByteArray {
        val body = text.encodeToByteArray()
        require(body.size <= 64 * 1024)
        return byteArrayOf(1, channel) + body
    }

    private fun decode(frame: ByteArray, channel: Byte): String {
        val payload = decodePayload(frame, channel)
        val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        return decoder.decode(ByteBuffer.wrap(payload)).toString()
    }

    fun decodePayload(frame: ByteArray, channel: Byte = 1): ByteArray {
        require(frame.size in 2..(64 * 1024 + 2) && frame[0] == 1.toByte() && frame[1] == channel) { "Message framing rejected" }
        return frame.copyOfRange(2, frame.size)
    }

    fun encodeText(text: String): ByteArray = encode(1, text)
    fun encodeControl(payload: ByteArray): ByteArray {
        require(payload.size <= 64 * 1024)
        return byteArrayOf(1, 1) + payload
    }
    fun decodeText(frame: ByteArray): String = decode(frame, 1)
    fun encodeSignaling(text: String): ByteArray = encode(2, text)
    fun decodeSignaling(frame: ByteArray): String = decode(frame, 2)
}
