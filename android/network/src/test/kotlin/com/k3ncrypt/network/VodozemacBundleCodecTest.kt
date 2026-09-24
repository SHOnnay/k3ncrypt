package com.k3ncrypt.network

import org.junit.Assert.assertEquals
import org.junit.Test

class VodozemacBundleCodecTest {
    @Test fun `one time key identifiers match browser sha256 convention`() {
        val key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        assertEquals("otk-Jw5ibd1atL8G-7NUROprar", VodozemacBundleCodec.keyId(key, "otk"))
        assertEquals("fallback-uXIYTP0yxg6o8jJLnfIsaN", VodozemacBundleCodec.keyId(key, "fallback"))
    }
}
