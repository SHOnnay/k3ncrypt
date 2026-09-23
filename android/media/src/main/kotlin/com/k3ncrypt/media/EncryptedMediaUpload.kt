package com.k3ncrypt.media

import com.k3ncrypt.security.DeviceAuthorizationProof
import com.k3ncrypt.security.ProofGuard
import com.k3ncrypt.security.ProofResource

/** Media module accepts encrypted chunks only; plaintext capture is never passed to transport. */
data class EncryptedMediaChunk(val attachmentId: String, val index: Int, val total: Int, val nonce: ByteArray, val ciphertext: ByteArray)

class EncryptedMediaUpload(private val now: () -> Long = { System.currentTimeMillis() }) {
    fun authorizeWrite(proof: DeviceAuthorizationProof, conversationId: String): Boolean =
        ProofGuard.validateFor(proof, "attachment:write", ProofResource(conversationId = conversationId), now()).isSuccess
    fun validateChunk(chunk: EncryptedMediaChunk) {
        require(chunk.index in 0 until chunk.total && chunk.total in 1..256)
        require(chunk.nonce.size == 12 && chunk.ciphertext.isNotEmpty())
    }
}
