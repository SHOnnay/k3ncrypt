package com.k3ncrypt.media

import org.junit.Assert.assertThrows
import org.junit.Test

class EncryptedMediaUploadTest {
    @Test fun `invalid nonce is rejected before upload`() { assertThrows(IllegalArgumentException::class.java) { EncryptedMediaUpload().validateChunk(EncryptedMediaChunk("id", 0, 1, byteArrayOf(), byteArrayOf(1))) } }
}
