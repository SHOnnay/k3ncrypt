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
        assertArrayEquals(byteArrayOf(0x4b, 0x33, 0x4e, 0x4c, 0x53, 0x58, 0x31, 0x0a), LocalSessionProtocol.preamble)
        LocalSessionProtocol.readPreamble(ByteArrayInputStream(LocalSessionProtocol.preamble))
        assertThrows(IllegalArgumentException::class.java) {
            LocalSessionProtocol.readPreamble(ByteArrayInputStream("K3NLSX2\n".toByteArray()))
        }
    }

    @Test fun validSyntheticTextRoundTripsThroughBoundedFrame() {
        val encoded = LocalSessionProtocol.text(1, "PING-A")
        val frame = LocalSessionProtocol.readFrame(ByteArrayInputStream(encoded))
        assertEquals(LocalSessionProtocol.TYPE_TEXT, frame.type)
        assertEquals("PING-A", LocalSessionProtocol.decodeText(frame, 1))
    }

    @Test fun maximumAllowedTextIs256Bytes() {
        val value = "x".repeat(256)
        val frame = LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.text(9, value)))
        assertEquals(value, LocalSessionProtocol.decodeText(frame, 9))
    }

    @Test fun textOver256BytesIsRejected() {
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.text(1, "x".repeat(257)) }
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.text(1, "π") }
    }

    @Test fun frameOver512BytesIsRejectedBeforeEncoding() {
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.encodeFrame(LocalSessionProtocol.TYPE_TEXT, ByteArray(512)) }
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

    @Test fun unknownFrameTypeCannotDecodeAsText() {
        val frame = LocalSessionProtocol.Frame(99, byteArrayOf(0, 0, 0, 1, 65))
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.decodeText(frame, 1) }
    }

    @Test fun sequenceMustBeExactlyExpected() {
        val frame = LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.text(2, "PING-A")))
        assertThrows(IllegalArgumentException::class.java) { LocalSessionProtocol.decodeText(frame, 1) }
    }

    @Test fun contextAndControlFramesAreStrict() {
        val host = ByteArray(16) { it.toByte() }
        val client = ByteArray(16) { (it + 16).toByte() }
        LocalSessionProtocol.validateContext(LocalSessionProtocol.readFrame(ByteArrayInputStream(LocalSessionProtocol.hello(host, client))), LocalSessionProtocol.TYPE_HELLO, host, client)
        assertThrows(IllegalArgumentException::class.java) {
            LocalSessionProtocol.validateContext(LocalSessionProtocol.Frame(LocalSessionProtocol.TYPE_ACCEPT, ByteArray(31)), LocalSessionProtocol.TYPE_ACCEPT, host, client)
        }
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
