package com.k3ncrypt.media

import org.junit.Assert.assertThrows
import org.junit.Test

class EncryptedMediaUploadTest {
    @Test fun `invalid nonce is rejected before upload`() { assertThrows(IllegalArgumentException::class.java) { EncryptedMediaUpload().validateChunk(EncryptedMediaChunk("id", 0, 1, byteArrayOf(), byteArrayOf(1))) } }
}

class AttachmentAeadVectorTest {
    private val properties = java.util.Properties().apply {
        val fixture = generateSequence(java.nio.file.Path.of("").toAbsolutePath()) { it.parent }
            .map { it.resolve("protocol-fixtures/v1/attachment-aead-v2.properties") }
            .firstOrNull(java.nio.file.Files::isRegularFile) ?: error("Shared attachment fixture is unavailable")
        java.nio.file.Files.newInputStream(fixture).use(::load)
    }
    private fun hex(name: String): ByteArray = properties.getProperty(name).chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private fun context(index: Int? = null) = AttachmentContext(
        properties.getProperty("transferId"), properties.getProperty("conversationId"),
        properties.getProperty("senderParticipantId"), properties.getProperty("recipientParticipantId"),
        properties.getProperty("senderIdentityReference"), properties.getProperty("recipientIdentityReference"),
        properties.getProperty("fileSize").toLong(), properties.getProperty("chunkSize").toInt(), properties.getProperty("chunkCount").toInt(), index,
    )
    private fun fixedRandom(vararg values: ByteArray): java.security.SecureRandom = object : java.security.SecureRandom() {
        private var index = 0
        override fun nextBytes(bytes: ByteArray) { values[index++].copyInto(bytes) }
    }
    @Test fun `opens shared manifest and chunk vectors and emits matching wire bytes`() {
        val key = hex("key")
        val manifest = hex("manifestPlaintextHex")
        val chunk = hex("chunkPlaintextHex")
        val manifestSealed = SealedAttachmentObject(hex("manifestNonce"), hex("manifestCiphertext"))
        val manifestValue = AttachmentManifestV2(11, 4, 3, 1, 86400001, "vector.txt", "text/plain")
        org.junit.Assert.assertArrayEquals(hex("manifestPlaintextHex"), AttachmentAead.encodeManifest(manifestValue))
        org.junit.Assert.assertEquals(manifestValue, AttachmentAead.decodeManifest(hex("manifestPlaintextHex")))
        val chunkSealed = SealedAttachmentObject(hex("chunkNonce"), hex("chunkCiphertext"))
        val crypto = AttachmentAead(fixedRandom(hex("manifestNonce"), hex("chunkNonce")))
        org.junit.Assert.assertEquals(manifestValue, crypto.decryptManifest(key, context(), manifestSealed))
        org.junit.Assert.assertArrayEquals(chunk, crypto.decryptChunk(key, context(properties.getProperty("chunkIndex").toInt()), chunkSealed))
        val producedManifest = crypto.encryptManifest(key, context(), manifestValue)
        org.junit.Assert.assertArrayEquals(hex("manifestNonce"), producedManifest.nonce)
        org.junit.Assert.assertArrayEquals(hex("manifestCiphertext"), producedManifest.ciphertextAndTag)
        val producedChunk = crypto.encryptChunk(key, context(properties.getProperty("chunkIndex").toInt()), chunk)
        org.junit.Assert.assertArrayEquals(hex("chunkNonce"), producedChunk.nonce)
        org.junit.Assert.assertArrayEquals(hex("chunkCiphertext"), producedChunk.ciphertextAndTag)
    }
    @Test fun `rejects context substitutions object confusion nonce and ciphertext tampering`() {
        val key = hex("key"); val nonce = hex("chunkNonce"); val ciphertext = hex("chunkCiphertext"); val index = properties.getProperty("chunkIndex").toInt()
        val crypto = AttachmentAead()
        val mutations = listOf(
            context(index).copy(transferId = "55555555-5555-4555-8555-555555555555"),
            context(index).copy(conversationId = "55555555-5555-4555-8555-555555555555"),
            context(index).copy(senderParticipantId = "55555555-5555-4555-8555-555555555555"),
            context(index).copy(recipientParticipantId = "55555555-5555-4555-8555-555555555555"),
            context(index).copy(senderIdentityReference = "K3 ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZ"),
            context(index).copy(chunkIndex = 2),
            context(index).copy(fileSize = 12, chunkCount = 3),
            context(index).copy(chunkSize = 5, chunkCount = 3),
        )
        mutations.forEach { changed -> org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { crypto.decrypt(key, AttachmentObjectType.CHUNK, changed, SealedAttachmentObject(nonce, ciphertext)) } }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { crypto.decrypt(key, AttachmentObjectType.MANIFEST, context(), SealedAttachmentObject(nonce, ciphertext)) }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { crypto.decrypt(key, AttachmentObjectType.CHUNK, context(index), SealedAttachmentObject(hex("manifestNonce"), hex("manifestCiphertext"))) }
        val changedIdentity = context(index).copy(recipientIdentityReference = "K3 ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZ")
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { crypto.decrypt(key, AttachmentObjectType.CHUNK, changedIdentity, SealedAttachmentObject(nonce, ciphertext)) }
        val changedCt = ciphertext.clone().also { it[0] = (it[0].toInt() xor 1).toByte() }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { crypto.decrypt(key, AttachmentObjectType.CHUNK, context(index), SealedAttachmentObject(nonce, changedCt)) }
        val changedTag = ciphertext.clone().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { crypto.decrypt(key, AttachmentObjectType.CHUNK, context(index), SealedAttachmentObject(nonce, changedTag)) }
        val changedNonce = nonce.clone().also { it[0] = (it[0].toInt() xor 1).toByte() }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { crypto.decrypt(key, AttachmentObjectType.CHUNK, context(index), SealedAttachmentObject(changedNonce, ciphertext)) }
    }

    @Test fun `normalizes manifest filenames consistently`() {
        val value = AttachmentManifestV2(11, 4, 3, 1, 86400001, " .foo. ", "text/plain")
        org.junit.Assert.assertEquals("foo", AttachmentAead.decodeManifest(AttachmentAead.encodeManifest(value)).filename)
    }
}
