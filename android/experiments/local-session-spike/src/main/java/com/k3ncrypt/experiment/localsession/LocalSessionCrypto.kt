package com.k3ncrypt.experiment.localsession

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Experimental Local Session cryptography for the isolated spike app only.
 *
 * This deliberately uses only standard platform primitives and a high-entropy,
 * user-transferred one-time pairing code. It does not reuse normal K3NCRYPT
 * identity keys, trust, storage, or protocol state, and it is not production
 * protocol approval.
 */
internal object LocalSessionCrypto {
    private const val CODE_CHARS = 20
    private const val CODE_GROUP = 4
    private const val AES_KEY_BYTES = 32
    private const val NONCE_PREFIX_BYTES = 4
    private const val GCM_TAG_BITS = 128
    private val alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toCharArray()
    private val handshakeDomain = "K3NCRYPT-LOCAL-SESSION-V2-PSK".toByteArray(Charsets.US_ASCII)
    private val textDomain = "K3NCRYPT-LOCAL-SESSION-V2-TEXT".toByteArray(Charsets.US_ASCII)

    data class KeySet(
        val clientToServerKey: ByteArray,
        val serverToClientKey: ByteArray,
        val clientNoncePrefix: ByteArray,
        val serverNoncePrefix: ByteArray,
        val authKey: ByteArray,
        val transcriptHash: ByteArray,
    ) {
        fun clear() {
            clientToServerKey.fill(0)
            serverToClientKey.fill(0)
            clientNoncePrefix.fill(0)
            serverNoncePrefix.fill(0)
            authKey.fill(0)
            transcriptHash.fill(0)
        }
    }

    fun generatePairingCode(random: SecureRandom): String = buildString(CODE_CHARS) {
        repeat(CODE_CHARS) { append(alphabet[random.nextInt(alphabet.size)]) }
    }

    fun normalizePairingCode(raw: String): String {
        val compact = raw.filterNot { it == '-' || it == ' ' }
        require(compact.length == CODE_CHARS) { "PAIRING_CODE_INVALID" }
        require(compact.all { it.code in 0x30..0x39 || it.code in 0x41..0x5a || it.code in 0x61..0x7a }) { "PAIRING_CODE_INVALID" }
        val normalized = compact.uppercase(java.util.Locale.ROOT)
        require(normalized.all { it in alphabet }) { "PAIRING_CODE_INVALID" }
        return normalized
    }

    fun formatPairingCode(normalized: String): String {
        val code = normalizePairingCode(normalized)
        return code.chunked(CODE_GROUP).joinToString("-")
    }

    fun transcript(
        hostContext: ByteArray,
        clientContext: ByteArray,
        clientNonce: ByteArray,
        serverNonce: ByteArray,
    ): ByteArray {
        require(hostContext.size == 16 && clientContext.size == 16 && clientNonce.size == 16 && serverNonce.size == 16) {
            "CONTEXT_MISMATCH"
        }
        return handshakeDomain + hostContext + clientContext + clientNonce + serverNonce
    }

    fun derive(code: String, transcript: ByteArray): KeySet {
        val normalized = normalizePairingCode(code)
        val transcriptHash = sha256(transcript)
        val salt = sha256(handshakeDomain + transcriptHash)
        val codeBytes = normalized.toByteArray(Charsets.US_ASCII)
        val prk = hmacSha256(salt, codeBytes)
        codeBytes.fill(0)
        try {
            return KeySet(
                clientToServerKey = hkdfExpand(prk, "client-to-server-key", AES_KEY_BYTES),
                serverToClientKey = hkdfExpand(prk, "server-to-client-key", AES_KEY_BYTES),
                clientNoncePrefix = hkdfExpand(prk, "client-nonce-prefix", NONCE_PREFIX_BYTES),
                serverNoncePrefix = hkdfExpand(prk, "server-nonce-prefix", NONCE_PREFIX_BYTES),
                authKey = hkdfExpand(prk, "auth-key", 32),
                transcriptHash = transcriptHash,
            )
        } finally {
            prk.fill(0)
            salt.fill(0)
        }
    }

    fun clientProof(keys: KeySet): ByteArray = proof(keys.authKey, "client-proof", keys.transcriptHash)
    fun serverProof(keys: KeySet): ByteArray = proof(keys.authKey, "server-accept", keys.transcriptHash)
    fun clientReadyProof(keys: KeySet): ByteArray = proof(keys.authKey, "client-ready", keys.transcriptHash)
    fun serverReadyProof(keys: KeySet): ByteArray = proof(keys.authKey, "server-ready-confirmation", keys.transcriptHash)

    fun verifyProof(expected: ByteArray, actual: ByteArray): Boolean =
        expected.size == actual.size && MessageDigest.isEqual(expected, actual)

    fun encryptText(
        key: ByteArray,
        noncePrefix: ByteArray,
        transcriptHash: ByteArray,
        direction: Byte,
        sequence: Long,
        plaintext: ByteArray,
    ): ByteArray {
        require(key.size == AES_KEY_BYTES && noncePrefix.size == NONCE_PREFIX_BYTES) { "CRYPTO_STATE_INVALID" }
        require(transcriptHash.size == 32) { "CRYPTO_STATE_INVALID" }
        require(sequence in 1..LocalSessionProtocol.maxMessagesPerSession.toLong()) { "UNEXPECTED_MESSAGE" }
        require(plaintext.isNotEmpty() && plaintext.size <= LocalSessionProtocol.maxText) { "INVALID_SYNTHETIC_TEXT" }
        val nonce = nonce(noncePrefix, sequence)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(GCM_TAG_BITS, nonce))
        cipher.updateAAD(aad(direction, sequence, transcriptHash))
        return cipher.doFinal(plaintext)
    }

    fun decryptText(
        key: ByteArray,
        noncePrefix: ByteArray,
        transcriptHash: ByteArray,
        direction: Byte,
        sequence: Long,
        ciphertext: ByteArray,
    ): ByteArray {
        require(key.size == AES_KEY_BYTES && noncePrefix.size == NONCE_PREFIX_BYTES) { "CRYPTO_STATE_INVALID" }
        require(transcriptHash.size == 32) { "CRYPTO_STATE_INVALID" }
        require(sequence in 1..LocalSessionProtocol.maxMessagesPerSession.toLong()) { "UNEXPECTED_MESSAGE" }
        require(ciphertext.size >= 16 && ciphertext.size <= LocalSessionProtocol.maxText + 16) { "FRAME_INVALID" }
        val nonce = nonce(noncePrefix, sequence)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(GCM_TAG_BITS, nonce))
        cipher.updateAAD(aad(direction, sequence, transcriptHash))
        return cipher.doFinal(ciphertext)
    }

    private fun proof(key: ByteArray, label: String, transcriptHash: ByteArray): ByteArray =
        hmacSha256(key, label.toByteArray(Charsets.US_ASCII) + transcriptHash)

    private fun nonce(prefix: ByteArray, sequence: Long): ByteArray =
        ByteBuffer.allocate(12).order(ByteOrder.BIG_ENDIAN).put(prefix).putLong(sequence).array()

    private fun aad(direction: Byte, sequence: Long, transcriptHash: ByteArray): ByteArray =
        ByteBuffer.allocate(textDomain.size + 1 + 8 + transcriptHash.size).order(ByteOrder.BIG_ENDIAN)
            .put(textDomain)
            .put(direction)
            .putLong(sequence)
            .put(transcriptHash)
            .array()

    private fun sha256(value: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(value)

    private fun hmacSha256(key: ByteArray, value: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(value)
    }

    private fun hkdfExpand(prk: ByteArray, label: String, length: Int): ByteArray {
        require(length in 1..32)
        val info = handshakeDomain + byteArrayOf(0) + label.toByteArray(Charsets.US_ASCII)
        val block = hmacSha256(prk, info + byteArrayOf(1))
        return block.copyOf(length).also { block.fill(0) }
    }
}
