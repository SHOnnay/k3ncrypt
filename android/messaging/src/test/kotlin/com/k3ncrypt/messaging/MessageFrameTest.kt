package com.k3ncrypt.messaging

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MessageFrameTest {
    @Test fun `frame matches browser version and channel prefix`() {
        assertArrayEquals(byteArrayOf(1, 1, 0x68, 0x69), MessageFrame.encodeText("hi"))
        assertEquals("hi", MessageFrame.decodeText(byteArrayOf(1, 1, 0x68, 0x69)))
    }

    @Test fun `signaling uses the browser channel frame`() {
        assertArrayEquals(byteArrayOf(1, 2, 0x7b, 0x7d), MessageFrame.encodeSignaling("{}"))
        assertEquals("{}", MessageFrame.decodeSignaling(byteArrayOf(1, 2, 0x7b, 0x7d)))
    }

    @Test fun `wrong channel and malformed utf8 fail closed`() {
        assertThrows(IllegalArgumentException::class.java) { MessageFrame.decodeText(byteArrayOf(1, 2, 0x68)) }
        assertThrows(IllegalArgumentException::class.java) { MessageFrame.decodeSignaling(byteArrayOf(1, 1, 0x68)) }
        assertThrows(Exception::class.java) { MessageFrame.decodeText(byteArrayOf(1, 1, 0xc3.toByte(), 0x28)) }
    }

    @Test fun `decoder accepts the maximum frame and rejects larger or incomplete frames`() {
        val maximum = MessageFrame.encodeText("a".repeat(64 * 1024))
        assertEquals(64 * 1024, MessageFrame.decodeText(maximum).length)
        assertThrows(IllegalArgumentException::class.java) { MessageFrame.decodeText(maximum + byteArrayOf(0x61)) }
        assertThrows(IllegalArgumentException::class.java) { MessageFrame.decodeText(byteArrayOf(1)) }
    }
}
