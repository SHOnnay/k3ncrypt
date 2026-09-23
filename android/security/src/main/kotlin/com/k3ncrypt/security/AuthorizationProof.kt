package com.k3ncrypt.security

import com.k3ncrypt.core.SafeError
import com.k3ncrypt.core.SafeErrorCategory

data class ProofResource(val conversationId: String? = null, val networkId: String? = null, val attachmentId: String? = null, val bridgeRouteId: String? = null)
data class DeviceAuthorizationProof(
    val version: Int, val proofId: String, val accountIdentityReference: String, val deviceId: String,
    val deviceIdentityReference: String, val operation: String, val trustEpoch: Long, val nonce: String,
    val resource: ProofResource?, val issuedAt: Long, val expiresAt: Long, val signature: String,
)

data class ProofCarrier(val deviceAuthorizationProof: DeviceAuthorizationProof, val proofNonce: String)

object ProofGuard {
    fun validateFor(proof: DeviceAuthorizationProof?, operation: String, resource: ProofResource?, now: Long): Result<ProofCarrier> {
        val value = proof ?: return Result.failure(IllegalStateException(SafeError(SafeErrorCategory.INVALID_PROOF, false, "proof-missing").toString()))
        if (value.expiresAt <= now) return Result.failure(IllegalStateException(SafeError(SafeErrorCategory.EXPIRED_PROOF, true, "proof-expired").toString()))
        if (value.operation != operation || value.resource != resource) return Result.failure(IllegalStateException(SafeError(SafeErrorCategory.INVALID_PROOF, false, "proof-scope").toString()))
        return Result.success(ProofCarrier(value, value.nonce))
    }
}
