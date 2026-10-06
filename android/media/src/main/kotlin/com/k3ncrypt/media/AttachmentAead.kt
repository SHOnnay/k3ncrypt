package com.k3ncrypt.media

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.text.Normalizer
import java.util.Locale
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Wire type discriminator; values are fixed by attachment-aad/v2. */
enum class AttachmentObjectType(val wire: Int) { MANIFEST(1), CHUNK(2) }
/** Stable, caller-verified public identities. Do not pass names or an ephemeral Olm session id. */
data class AttachmentContext(
    val transferId: String,
    val conversationId: String,
    val senderParticipantId: String,
    val recipientParticipantId: String,
    val senderIdentityReference: String,
    val recipientIdentityReference: String,
    val fileSize: Long,
    val chunkSize: Int,
    val chunkCount: Int,
    val chunkIndex: Int? = null,
)
data class SealedAttachmentObject(val nonce: ByteArray, val ciphertextAndTag: ByteArray)
data class AttachmentManifestV2(val fileSize: Long, val chunkSize: Int, val chunkCount: Int, val createdAt: Long, val expiresAt: Long, val filename: String, val mimeType: String)

/** Standard Android AES/GCM/NoPadding adapter for caller-supplied shared file keys. It never touches the local Keystore key. */
class AttachmentAead internal constructor(private val random: SecureRandom) {
    constructor() : this(SecureRandom())
    fun encrypt(key: ByteArray, type: AttachmentObjectType, context: AttachmentContext, plaintext: ByteArray): SealedAttachmentObject {
        require(key.size == KEY_BYTES) { "Invalid attachment key" }
        val nonce = ByteArray(NONCE_BYTES).also(random::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(encodeContext(type, context))
        return SealedAttachmentObject(nonce, cipher.doFinal(plaintext)) // WebCrypto layout: ciphertext || 16-byte tag.
    }

    fun decrypt(key: ByteArray, type: AttachmentObjectType, context: AttachmentContext, sealed: SealedAttachmentObject): ByteArray {
        require(key.size == KEY_BYTES && sealed.nonce.size == NONCE_BYTES && sealed.ciphertextAndTag.size >= TAG_BYTES_BYTES) { "Invalid attachment ciphertext" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, sealed.nonce))
        cipher.updateAAD(encodeContext(type, context))
        return try { cipher.doFinal(sealed.ciphertextAndTag) } catch (_: java.security.GeneralSecurityException) { throw IllegalArgumentException("Attachment authentication failed") }
    }

    fun encryptManifest(key: ByteArray, context: AttachmentContext, manifest: AttachmentManifestV2): SealedAttachmentObject {
        require(manifest.fileSize == context.fileSize && manifest.chunkSize == context.chunkSize && manifest.chunkCount == context.chunkCount) { "Attachment manifest/context mismatch" }
        return encrypt(key, AttachmentObjectType.MANIFEST, context, encodeManifest(manifest))
    }

    fun decryptManifest(key: ByteArray, context: AttachmentContext, sealed: SealedAttachmentObject): AttachmentManifestV2 {
        val manifest = decodeManifest(decrypt(key, AttachmentObjectType.MANIFEST, context, sealed))
        require(manifest.fileSize == context.fileSize && manifest.chunkSize == context.chunkSize && manifest.chunkCount == context.chunkCount) { "Attachment manifest/context mismatch" }
        return manifest
    }

    fun encryptChunk(key: ByteArray, context: AttachmentContext, plaintext: ByteArray): SealedAttachmentObject {
        require(context.chunkIndex != null && plaintext.size == expectedChunkLength(context)) { "Attachment chunk length mismatch" }
        return encrypt(key, AttachmentObjectType.CHUNK, context, plaintext)
    }

    fun decryptChunk(key: ByteArray, context: AttachmentContext, sealed: SealedAttachmentObject): ByteArray {
        val plaintext = decrypt(key, AttachmentObjectType.CHUNK, context, sealed)
        if (context.chunkIndex == null || plaintext.size != expectedChunkLength(context)) { plaintext.fill(0); throw IllegalArgumentException("Attachment chunk length mismatch") }
        return plaintext
    }

    private fun expectedChunkLength(context: AttachmentContext): Int {
        require(context.chunkIndex != null && context.chunkIndex in 0 until context.chunkCount)
        return minOf(context.chunkSize.toLong(), context.fileSize - context.chunkIndex.toLong() * context.chunkSize).toInt()
    }

    companion object {
        private const val KEY_BYTES = 32
        private const val NONCE_BYTES = 12
        private const val TAG_BITS = 128
        private const val TAG_BYTES_BYTES = 16
        private val UUID_PATTERN = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")
        private fun uuid(value: String): ByteArray {
            require(UUID_PATTERN.matches(value)) { "Invalid attachment UUID" }
            val parsed = UUID.fromString(value)
            return ByteBuffer.allocate(16).putLong(parsed.mostSignificantBits).putLong(parsed.leastSignificantBits).array()
        }
        private fun text(value: String): ByteArray {
            require(value.isNotEmpty() && value.length <= 512 && value.none { it.isISOControl() }) { "Invalid attachment identity reference" }
            val encoded = StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(value))
            val bytes = ByteArray(encoded.remaining()).also(encoded::get)
            require(bytes.size <= 2048)
            return bytes
        }
        private fun writeShortBytes(output: DataOutputStream, bytes: ByteArray) { require(bytes.size <= 0xffff); output.writeShort(bytes.size); output.write(bytes) }
        private const val MANIFEST_DOMAIN = "k3ncrypt/manifest/v2\u0000"
        private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
        private val IDENTITY_REFERENCE_PATTERN = Regex("K3 (?:[A-Z0-9_-]{4} ){10}[A-Z0-9_-]{3}")
        private fun safeFilename(value: String): String {
            require(value.length <= 512)
            var cursor = 0
            while (cursor < value.length) {
                val current = value[cursor]
                if (Character.isHighSurrogate(current)) { require(cursor + 1 < value.length && Character.isLowSurrogate(value[cursor + 1])); cursor += 2 }
                else { require(!Character.isLowSurrogate(current)); cursor += 1 }
            }
            val normalized = Normalizer.normalize(value, Normalizer.Form.NFC)
            val replaced = normalized.replace(Regex("[\\x00-\\x1f\\x7f-\\x9f\\u202a-\\u202e\\u2066-\\u2069/\\\\:*?\"<>|]"), "_").trim { it == '.' || it == ' ' }
            val shortened = replaced.codePoints().limit(120).toArray().let { points -> String(points, 0, points.size) }.trimEnd('.', ' ')
            return if (shortened.isEmpty() || Regex("(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\\.|$)").containsMatchIn(shortened)) "protected-file" else shortened
        }
        private fun safeMime(value: String): String = value.lowercase(Locale.ROOT).takeIf { it.length <= 127 && Regex("^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$").matches(it) } ?: "application/octet-stream"
        fun encodeManifest(value: AttachmentManifestV2): ByteArray {
            require(value.fileSize in 1..(50L * 1024 * 1024) && value.chunkSize in 1..(256 * 1024) && value.chunkCount == ((value.fileSize + value.chunkSize - 1) / value.chunkSize).toInt() && value.chunkCount in 1..256 && value.createdAt in 0..MAX_SAFE_INTEGER && value.expiresAt in (value.createdAt + 1)..MAX_SAFE_INTEGER && value.expiresAt - value.createdAt <= 604_800_000L)
            val filename = safeFilename(value.filename).toByteArray(StandardCharsets.UTF_8); val mime = safeMime(value.mimeType).toByteArray(StandardCharsets.UTF_8)
            val bytes = ByteArrayOutputStream()
            DataOutputStream(bytes).use { out -> out.write(MANIFEST_DOMAIN.toByteArray(StandardCharsets.US_ASCII)); out.writeLong(value.fileSize); out.writeInt(value.chunkSize); out.writeInt(value.chunkCount); out.writeLong(value.createdAt); out.writeLong(value.expiresAt); writeShortBytes(out, filename); writeShortBytes(out, mime) }
            return bytes.toByteArray()
        }
        fun decodeManifest(bytes: ByteArray): AttachmentManifestV2 {
            val input = java.io.DataInputStream(bytes.inputStream()); val domain = MANIFEST_DOMAIN.toByteArray(StandardCharsets.US_ASCII)
            require(bytes.size >= domain.size + 36 && bytes.copyOfRange(0, domain.size).contentEquals(domain)); input.skipBytes(domain.size)
            val fileSize = input.readLong(); val chunkSize = input.readInt(); val chunkCount = input.readInt(); val createdAt = input.readLong(); val expiresAt = input.readLong()
            fun readText(max: Int): String { val length = input.readUnsignedShort(); require(length <= max && length <= input.available()); val bytesPart = ByteArray(length); input.readFully(bytesPart); val decoded = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytesPart)).toString(); require(decoded.toByteArray(StandardCharsets.UTF_8).contentEquals(bytesPart)); return decoded }
            val value = AttachmentManifestV2(fileSize, chunkSize, chunkCount, createdAt, expiresAt, readText(1024), readText(127))
            require(input.available() == 0 && encodeManifest(value).contentEquals(bytes))
            return value
        }
        /** Exact big-endian binary format documented by service/src/attachments/portableContext.ts. */
        fun encodeContext(type: AttachmentObjectType, context: AttachmentContext): ByteArray {
            require(context.senderParticipantId != context.recipientParticipantId && context.senderIdentityReference != context.recipientIdentityReference)
            require(IDENTITY_REFERENCE_PATTERN.matches(context.senderIdentityReference) && IDENTITY_REFERENCE_PATTERN.matches(context.recipientIdentityReference))
            require(context.fileSize in 1..(50L * 1024 * 1024) && context.chunkSize in 1..(256 * 1024))
            require(context.chunkCount == ((context.fileSize + context.chunkSize - 1) / context.chunkSize).toInt() && context.chunkCount in 1..256)
            val index = when (type) {
                AttachmentObjectType.MANIFEST -> { require(context.chunkIndex == null); 0xffff_ffffL }
                AttachmentObjectType.CHUNK -> { val value = context.chunkIndex; require(value != null && value in 0 until context.chunkCount); value.toLong() }
            }
            val sender = text(context.senderIdentityReference); val recipient = text(context.recipientIdentityReference)
            val bytes = ByteArrayOutputStream()
            DataOutputStream(bytes).use { out ->
                out.write("k3ncrypt/attachment-aad/v2\u0000".toByteArray(StandardCharsets.US_ASCII))
                out.writeByte(2); out.writeByte(type.wire)
                out.write(uuid(context.transferId)); out.write(uuid(context.conversationId)); out.write(uuid(context.senderParticipantId)); out.write(uuid(context.recipientParticipantId))
                writeShortBytes(out, sender); writeShortBytes(out, recipient)
                out.writeLong(context.fileSize); out.writeInt(context.chunkSize); out.writeInt(context.chunkCount); out.writeInt(index.toInt())
            }
            return bytes.toByteArray()
        }
    }
}
