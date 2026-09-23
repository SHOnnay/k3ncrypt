package com.k3ncrypt.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ByteEncodingTest {
    @Test fun `base64url is unpadded and SHA-256 is lower hex`() {
        assertEquals("AQID", ByteEncoding.base64Url(byteArrayOf(1, 2, 3)))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", ByteEncoding.sha256Hex("abc".encodeToByteArray()))
    }
    @Test fun `invalid base64url is rejected`() { assertThrows(IllegalArgumentException::class.java) { ByteEncoding.base64UrlDecode("abc=") } }
}
