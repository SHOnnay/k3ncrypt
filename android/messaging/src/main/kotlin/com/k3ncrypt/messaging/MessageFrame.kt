package com.k3ncrypt.messaging

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Browser-compatible vodozemac message-channel frame: version=1, channel=1, UTF-8 text. */
object MessageFrame {
    fun encodeText(text: String): ByteArray {
        val body = text.encodeToByteArray()
        require(body.size <= 64 * 1024)
        return byteArrayOf(1, 1) + body
    }

    fun decodeText(frame: ByteArray): String {
        require(frame.size >= 2 && frame[0] == 1.toByte() && frame[1] == 1.toByte()) { "Message framing rejected" }
        val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        return decoder.decode(ByteBuffer.wrap(frame, 2, frame.size - 2)).toString()
    }
}
