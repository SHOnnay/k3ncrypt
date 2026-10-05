package com.k3ncrypt.experiment.localsession

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Throwaway transport test framing. It is not an application security protocol. */
internal object LocalSessionProtocol {
    val preamble = byteArrayOf(0x4b, 0x33, 0x4e, 0x4c, 0x53, 0x58, 0x31, 0x0a) // K3NLSX1\n
    const val maxWireFrame = 512
    // The four-byte big-endian length prefix is part of the complete frame.
    const val maxPayload = maxWireFrame - 4
    const val maxText = 256
    const val TYPE_HELLO: Byte = 1
    const val TYPE_ACCEPT: Byte = 2
    const val TYPE_TEXT: Byte = 3
    const val TYPE_CLOSE: Byte = 4

    data class Frame(val type: Byte, val body: ByteArray)

    fun encodeFrame(type: Byte, body: ByteArray): ByteArray {
        val size = 1 + body.size
        require(size in 1..maxPayload) { "FRAME_TOO_LARGE" }
        return ByteBuffer.allocate(4 + size).order(ByteOrder.BIG_ENDIAN)
            .putInt(size).put(type).put(body).array()
    }

    fun readPreamble(input: InputStream) {
        val got = ByteArray(preamble.size)
        DataInputStream(input).readFully(got)
        require(got.contentEquals(preamble)) { "BAD_MAGIC" }
    }

    fun writePreamble(output: OutputStream) {
        output.write(preamble)
        output.flush()
    }

    fun readFrame(input: InputStream): Frame {
        val data = DataInputStream(input)
        val first = data.read()
        if (first < 0) throw EOFException("PEER_DISCONNECTED")
        val header = ByteArray(4)
        header[0] = first.toByte()
        data.readFully(header, 1, 3)
        val size = ByteBuffer.wrap(header).order(ByteOrder.BIG_ENDIAN).int
        require(size in 1..maxPayload) { "FRAME_TOO_LARGE" }
        val payload = ByteArray(size)
        data.readFully(payload)
        return Frame(payload[0], payload.copyOfRange(1, payload.size))
    }

    fun hello(host: ByteArray, client: ByteArray): ByteArray = contextFrame(TYPE_HELLO, host, client)
    fun accept(host: ByteArray, client: ByteArray): ByteArray = contextFrame(TYPE_ACCEPT, host, client)

    private fun contextFrame(type: Byte, host: ByteArray, client: ByteArray): ByteArray {
        require(host.size == 16 && client.size == 16)
        return encodeFrame(type, host + client)
    }

    fun validateContext(frame: Frame, type: Byte, expectedHost: ByteArray, expectedClient: ByteArray) {
        require(frame.type == type && frame.body.size == 32) { "UNEXPECTED_MESSAGE" }
        require(frame.body.copyOfRange(0, 16).contentEquals(expectedHost) &&
            frame.body.copyOfRange(16, 32).contentEquals(expectedClient)) { "CONTEXT_MISMATCH" }
    }

    fun text(sequence: Long, value: String): ByteArray {
        require(value.isNotEmpty() && value.length <= maxText && value.all { it.code in 0x20..0x7e }) { "INVALID_SYNTHETIC_TEXT" }
        val bytes = value.toByteArray(Charsets.US_ASCII)
        require(bytes.isNotEmpty() && bytes.size <= maxText)
        require(sequence in 1..0xffff_ffffL)
        val body = ByteBuffer.allocate(4 + bytes.size).order(ByteOrder.BIG_ENDIAN).putInt(sequence.toInt()).put(bytes).array()
        return encodeFrame(TYPE_TEXT, body)
    }

    fun decodeText(frame: Frame, expectedSequence: Long): String {
        require(frame.type == TYPE_TEXT && frame.body.size in 5..(4 + maxText)) { "UNEXPECTED_MESSAGE" }
        val buffer = ByteBuffer.wrap(frame.body).order(ByteOrder.BIG_ENDIAN)
        val sequence = buffer.int.toLong() and 0xffff_ffffL
        require(sequence == expectedSequence) { "UNEXPECTED_MESSAGE" }
        val bytes = frame.body.copyOfRange(4, frame.body.size)
        require(bytes.all { it.toInt() in 0x20..0x7e }) { "UNEXPECTED_MESSAGE" }
        return bytes.toString(Charsets.US_ASCII)
    }

    fun closeFrame(): ByteArray = encodeFrame(TYPE_CLOSE, byteArrayOf())

    fun validateClose(frame: Frame) {
        require(frame.type == TYPE_CLOSE && frame.body.isEmpty()) { "UNEXPECTED_MESSAGE" }
    }
}
