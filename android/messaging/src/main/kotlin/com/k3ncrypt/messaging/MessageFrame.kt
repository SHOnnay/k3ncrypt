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
        require(frame.size in 2..(64 * 1024 + 2) && frame[0] == 1.toByte() && frame[1] == channel) { "Message framing rejected" }
        val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        return decoder.decode(ByteBuffer.wrap(frame, 2, frame.size - 2)).toString()
    }

    fun encodeText(text: String): ByteArray = encode(1, text)
    fun decodeText(frame: ByteArray): String = decode(frame, 1)
    fun encodeSignaling(text: String): ByteArray = encode(2, text)
    fun decodeSignaling(frame: ByteArray): String = decode(frame, 2)
}
