package com.k3ncrypt.experiment.localsession

import java.io.DataInputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Experimental authenticated/encrypted Local Session framing. Not production protocol approval. */
internal object LocalSessionProtocol {
    val preamble = byteArrayOf(0x4b, 0x33, 0x4e, 0x4c, 0x53, 0x58, 0x32, 0x0a) // K3NLSX2\n
    const val maxWireFrame = 512
    const val maxPayload = maxWireFrame - 4
    const val maxText = 256
    const val maxMessagesPerSession = 100

    const val TYPE_HELLO: Byte = 1
    const val TYPE_CHALLENGE: Byte = 2
    const val TYPE_AUTH: Byte = 3
    const val TYPE_ACCEPT: Byte = 4
    const val TYPE_READY: Byte = 5
    const val TYPE_SECURE_TEXT: Byte = 6
    const val TYPE_CLOSE: Byte = 7
    const val TYPE_READY_ACK: Byte = 8

    data class Frame(val type: Byte, val body: ByteArray)
    data class Hello(val hostContext: ByteArray, val clientContext: ByteArray, val clientNonce: ByteArray)
    data class Challenge(
        val hostContext: ByteArray,
        val clientContext: ByteArray,
        val clientNonce: ByteArray,
        val serverNonce: ByteArray,
    )
    data class SecureText(val sequence: Long, val ciphertext: ByteArray)

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

    fun hello(host: ByteArray, client: ByteArray, clientNonce: ByteArray): ByteArray {
        require(host.size == 16 && client.size == 16 && clientNonce.size == 16) { "CONTEXT_MISMATCH" }
        return encodeFrame(TYPE_HELLO, host + client + clientNonce)
    }

    fun decodeHello(frame: Frame, expectedHost: ByteArray): Hello {
        require(frame.type == TYPE_HELLO && frame.body.size == 48) { "UNEXPECTED_MESSAGE" }
        val host = frame.body.copyOfRange(0, 16)
        val client = frame.body.copyOfRange(16, 32)
        val nonce = frame.body.copyOfRange(32, 48)
        require(host.contentEquals(expectedHost)) { "CONTEXT_MISMATCH" }
        return Hello(host, client, nonce)
    }

    fun challenge(host: ByteArray, client: ByteArray, clientNonce: ByteArray, serverNonce: ByteArray): ByteArray {
        require(host.size == 16 && client.size == 16 && clientNonce.size == 16 && serverNonce.size == 16) { "CONTEXT_MISMATCH" }
        return encodeFrame(TYPE_CHALLENGE, host + client + clientNonce + serverNonce)
    }

    fun decodeChallenge(
        frame: Frame,
        expectedHost: ByteArray,
        expectedClient: ByteArray,
        expectedClientNonce: ByteArray,
    ): Challenge {
        require(frame.type == TYPE_CHALLENGE && frame.body.size == 64) { "UNEXPECTED_MESSAGE" }
        val host = frame.body.copyOfRange(0, 16)
        val client = frame.body.copyOfRange(16, 32)
        val clientNonce = frame.body.copyOfRange(32, 48)
        val serverNonce = frame.body.copyOfRange(48, 64)
        require(host.contentEquals(expectedHost) && client.contentEquals(expectedClient) && clientNonce.contentEquals(expectedClientNonce)) {
            "CONTEXT_MISMATCH"
        }
        return Challenge(host, client, clientNonce, serverNonce)
    }

    fun auth(proof: ByteArray): ByteArray {
        require(proof.size == 32) { "FRAME_INVALID" }
        return encodeFrame(TYPE_AUTH, proof)
    }

    fun accept(proof: ByteArray): ByteArray {
        require(proof.size == 32) { "FRAME_INVALID" }
        return encodeFrame(TYPE_ACCEPT, proof)
    }

    fun ready(proof: ByteArray): ByteArray {
        require(proof.size == 32) { "FRAME_INVALID" }
        return encodeFrame(TYPE_READY, proof)
    }

    fun readyAck(proof: ByteArray): ByteArray {
        require(proof.size == 32) { "FRAME_INVALID" }
        return encodeFrame(TYPE_READY_ACK, proof)
    }

    fun decodeProof(frame: Frame, expectedType: Byte): ByteArray {
        require(frame.type == expectedType && frame.body.size == 32) { "UNEXPECTED_MESSAGE" }
        return frame.body.copyOf()
    }

    fun secureText(sequence: Long, ciphertext: ByteArray): ByteArray {
        require(sequence in 1..maxMessagesPerSession.toLong()) { "UNEXPECTED_MESSAGE" }
        require(ciphertext.size in 16..(maxText + 16)) { "FRAME_INVALID" }
        val body = ByteBuffer.allocate(8 + ciphertext.size).order(ByteOrder.BIG_ENDIAN)
            .putLong(sequence)
            .put(ciphertext)
            .array()
        return encodeFrame(TYPE_SECURE_TEXT, body)
    }

    fun decodeSecureText(frame: Frame): SecureText {
        require(frame.type == TYPE_SECURE_TEXT && frame.body.size in 24..(8 + maxText + 16)) { "UNEXPECTED_MESSAGE" }
        val buffer = ByteBuffer.wrap(frame.body).order(ByteOrder.BIG_ENDIAN)
        val sequence = buffer.long
        require(sequence in 1..maxMessagesPerSession.toLong()) { "UNEXPECTED_MESSAGE" }
        val ciphertext = frame.body.copyOfRange(8, frame.body.size)
        return SecureText(sequence, ciphertext)
    }

    fun requireExpectedSequence(actual: Long, expected: Long) {
        require(expected in 1..maxMessagesPerSession.toLong() && actual == expected) { "UNEXPECTED_MESSAGE" }
    }

    fun validateSyntheticText(value: String): ByteArray {
        require(value.isNotEmpty() && value.length <= maxText && value.all { it.code in 0x20..0x7e }) { "INVALID_SYNTHETIC_TEXT" }
        return value.toByteArray(Charsets.US_ASCII).also { require(it.size <= maxText) }
    }

    fun decodeSyntheticText(bytes: ByteArray): String {
        require(bytes.isNotEmpty() && bytes.size <= maxText) { "UNEXPECTED_MESSAGE" }
        require(bytes.all { it.toInt() in 0x20..0x7e }) { "UNEXPECTED_MESSAGE" }
        return bytes.toString(Charsets.US_ASCII)
    }

    fun closeFrame(): ByteArray = encodeFrame(TYPE_CLOSE, byteArrayOf())

    fun validateClose(frame: Frame) {
        require(frame.type == TYPE_CLOSE && frame.body.isEmpty()) { "UNEXPECTED_MESSAGE" }
    }
}
