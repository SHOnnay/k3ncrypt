package com.k3ncrypt.media
import org.junit.Assert.*
import org.junit.Test
import java.util.Properties
import java.nio.file.Files
import java.nio.file.Path
import java.security.SecureRandom
class FileFlowCompatibilityTest {
    private val fixture = Properties().apply { val path = generateSequence(Path.of("").toAbsolutePath()) { it.parent }.map { it.resolve("protocol-fixtures/v1/file-transfer-v2.properties") }.first(Files::isRegularFile); Files.newInputStream(path).use(::load) }
    private fun hex(value: String) = fixture.getProperty(value).chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    @Test fun bothSenderDirectionsOpenAndEmitIdenticalManifestAndFinalChunk() {
        for (direction in listOf("web", "android")) {
            fun v(name: String) = fixture.getProperty("$direction.$name")
            val c = AttachmentContext(v("transferId"), v("conversationId"), v("senderParticipantId"), v("recipientParticipantId"), v("senderIdentityReference"), v("recipientIdentityReference"), 11, 262144, 1)
            FileTransferLimits.validate(c)
            val key = hex("key"); val plaintext = hex("plaintext")
            val manifestObject = SealedAttachmentObject(hex("$direction.manifestNonce"), hex("$direction.manifestCiphertext"))
            val chunkObject = SealedAttachmentObject(hex("$direction.chunkNonce"), hex("$direction.chunkCiphertext"))
            val adapter = AttachmentAead(); val manifest = adapter.decryptManifest(key, c, manifestObject)
            assertEquals("family-photo.jpg", manifest.filename); assertEquals("image/jpeg", manifest.mimeType); assertEquals(1, manifest.chunkCount)
            assertArrayEquals(plaintext, adapter.decryptChunk(key, c.copy(chunkIndex = 0), chunkObject))
            val nonces = listOf(manifestObject.nonce, chunkObject.nonce); var at = 0
            val fixed = AttachmentAead(object : SecureRandom() { override fun nextBytes(bytes: ByteArray) { nonces[at++].copyInto(bytes) } })
            assertArrayEquals(manifestObject.ciphertextAndTag, fixed.encryptManifest(key, c, manifest).ciphertextAndTag)
            assertArrayEquals(chunkObject.ciphertextAndTag, fixed.encryptChunk(key, c.copy(chunkIndex = 0), plaintext).ciphertextAndTag)
            assertThrows(IllegalArgumentException::class.java) { adapter.decryptChunk(key, c.copy(chunkIndex = 1), chunkObject) }
        }
    }
}
