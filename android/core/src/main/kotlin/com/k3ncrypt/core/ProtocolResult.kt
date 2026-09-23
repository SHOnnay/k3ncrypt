package com.k3ncrypt.core

/** Safe categories only; callers must never attach plaintext or secret material. */
sealed interface ProtocolResult<out T> {
    data class Success<T>(val value: T) : ProtocolResult<T>
    data class Failure(val error: SafeError) : ProtocolResult<Nothing>
}

enum class SafeErrorCategory {
    AUTHENTICATION_FAILURE,
    INVALID_PROOF,
    EXPIRED_PROOF,
    IDENTITY_MISMATCH,
    REVOKED_DEVICE,
    INVALID_ENVELOPE,
    PERSISTENCE_FAILURE,
    NETWORK_FAILURE,
}

data class SafeError(
    val category: SafeErrorCategory,
    val retryable: Boolean,
    val stage: String,
    val correlationId: String? = null,
)
