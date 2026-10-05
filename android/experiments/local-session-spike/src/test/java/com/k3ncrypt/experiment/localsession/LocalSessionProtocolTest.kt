package com.k3ncrypt.experiment.localsession

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.*
import org.junit.Test

class LocalSessionProtocolTest {
    @Test fun magicAndVersionAreExplicit() {
        assertArrayEquals(byteArrayOf(0x4b, 0x33, 0x4e, 0x4c, 0x53, 0x58, 0x32, 0x0a), LocalSessionProtocol.preamble)
        LocalSessionProtocol.readPreamble(ByteArrayInputStream(LocalSessionProtocol.preamble))
        assertThrows(IllegalArgumentException::class.java) {
            LocalSessionProtocol.readPreamble(ByteArrayInputStream("K3NLSX1\n".toByteArray()))
        }
    }

    @Test fun helloAndChallengeBindExactContexts() {
        val host = ByteArray(16) { it.toByte() }
        val client = ByteArray(16) { (it + 16).toByte() }
        val cn = ByteArray(16) { (it + 32).toByte() }
        val sn = ByteArray(16) { (it + 48).toByte() }
        val hello = LocalSessionProtocol.decodeHello(
            LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.hello(host, client, cn))), host
        )
        assertArrayEquals(client, hello.clientContext)
        assertArrayEquals(cn, hello.clientNonce)
        val challenge = LocalSessionProtocol.decodeChallenge(
            LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.challenge(host, client, cn, sn))), host, client, cn
        )
        assertArrayEquals(sn, challenge.serverNonce)
        assertThrows(IllegalArgumentException::class.java) {
            LocalSessionProtocol.decodeChallenge(
                LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.challenge(host, client, cn, sn))),
                ByteArray(16), client, cn
            )
        }
    }

    @Test fun authAcceptAndReadyProofsAreExactly32Bytes() {
        val proof = ByteArray(32) { it.toByte() }
        assertArrayEquals(proof, LocalSessionProtocol.decodeProof(
            LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.auth(proof))), LocalSessionProtocol.TYPE_AUTH
        ))
        assertArrayEquals(proof, LocalSessionProtocol.decodeProof(
            LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.accept(proof))), LocalSessionProtocol.TYPE_ACCEPT
        ))
        assertArrayEquals(proof, LocalSessionProtocol.decodeProof(
            LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.ready(proof))), LocalSessionProtocol.TYPE_READY
        ))
        assertArrayEquals(proof, LocalSessionProtocol.decodeProof(
            LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.readyAck(proof))), LocalSessionProtocol.TYPE_READY_ACK
        ))
        assertThrows(IllegalArgumentException::class.java) {
            LocalSessionProtocol.decodeProof(
                LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.ready(proof))),
                LocalSessionProtocol.TYPE_READY_ACK,
            )
        }
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.auth(ByteArray(31)) }
    }

    @Test fun secureTextFrameRoundTripsSequenceAndCiphertext() {
        val ciphertext = ByteArray(32) { (it + 1).toByte() }
        val parsed = LocalSessionProtocol.decodeSecureText(
            LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.secureText(7, ciphertext)))
        )
        assertEquals(7L, parsed.sequence)
        assertArrayEquals(ciphertext, parsed.ciphertext)
    }

    @Test fun syntheticTextIsBoundedPrintableAscii() {
        val value = "x".repeat(256)
        assertEquals(value, LocalSessionProtocol.decodeSyntheticText(LocalSessionProtocol.validateSyntheticText(value)))
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.validateSyntheticText("x".repeat(257)) }
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.validateSyntheticText("π") }
    }

    @Test fun completeFrameAt512BytesIsAccepted() {
        val encoded = LocalSessionProtocol.encodeFrame(LocalSessionProtocol.TYPE_SECURE_TEXT, ByteArray(LocalSessionProtocol.maxPayload - 1))
        assertEquals(512, encoded.size)
        assertEquals(LocalSessionProtocol.maxPayload, LocalSessionProtocol.readFrame(ByteArrayInputStream(encoded)).body.size + 1)
    }

    @Test fun frameOver512BytesIsRejectedBeforeEncoding() {
        assertThrows(IllegalArgumentException::class.java) {
            LocalSessionProtocol.encodeFrame(LocalSessionProtocol.TYPE_SECURE_TEXT, ByteArray(LocalSessionProtocol.maxPayload))
        }
    }

    @Test fun negativeAndOversizedLengthsAreRejectedBeforeAllocation() {
        for (size in listOf(-1, 513, Int.MAX_VALUE)) {
            val input = ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(size).array()
            assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.readFrame(ByteArrayInputStream(input)) }
        }
    }

    @Test fun truncatedHeaderAndBodyAreRejected() {
        assertThrows(EOFException::class.java) { LocalSessionProtocol.readFrame(ByteArrayInputStream(byteArrayOf(0, 0))) }
        val headerOnly = ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(4).array()
        assertThrows(EOFException::class.java) { LocalSessionProtocol.readFrame(ByteArrayInputStream(headerOnly)) }
    }

    @Test fun unknownFrameTypeCannotDecodeAsSecureText() {
        val frame = LocalSessionProtocol.Frame(99, ByteArray(24))
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.decodeSecureText(frame) }
    }

    @Test fun malformedSecureTextLengthsAreRejected() {
        for (body in listOf(ByteArray(0), ByteArray(23), ByteArray(8 + 256 + 16 + 1))) {
            assertThrows(IllegalArgumentException::class.java) {
                LocalSessionProtocol.decodeSecureText(LocalSessionProtocol.Frame(LocalSessionProtocol.TYPE_SECURE_TEXT, body))
            }
        }
    }

    @Test fun secureSequenceMustBePositive() {
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.secureText(0, ByteArray(16)) }
        val body = ByteBuffer.allocate(24).order(ByteOrder.BIG_ENDIAN).putLong(0).put(ByteArray(16)).array()
        assertThrows(IllegalArgumentException::class.java) {
            LocalSessionProtocol.decodeSecureText(LocalSessionProtocol.Frame(LocalSessionProtocol.TYPE_SECURE_TEXT, body))
        }
    }

    @Test fun secureSequenceMustBeExpectedAndWithinSessionLimit() {
        LocalSessionProtocol.requireExpectedSequence(1, 1)
        LocalSessionProtocol.requireExpectedSequence(100, 100)
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.requireExpectedSequence(1, 2) }
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.requireExpectedSequence(2, 1) }
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.requireExpectedSequence(101, 101) }
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.secureText(101, ByteArray(16)) }
    }

    @Test fun closeFrameIsStrict() {
        LocalSessionProtocol.validateClose(LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.closeFrame())))
        assertThrows(IllegalArgumentException::class.java) {
            LocalSessionProtocol.validateClose(LocalSessionProtocol.Frame(LocalSessionProtocol.TYPE_CLOSE, byteArrayOf(1)))
        }
    }

    @Test fun writeAndReadPreambleUseNoExtraBytes() {
        val out = ByteArrayOutputStream()
        LocalSessionProtocol.writePreamble(out)
        assertArrayEquals(LocalSessionProtocol.preamble, out.toByteArray())
    }
}
