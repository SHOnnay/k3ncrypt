package com.k3ncrypt.network

import com.k3ncrypt.security.DeviceAuthorizationProof
import com.k3ncrypt.security.ProofResource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class IssuedProofValidationTest {
    private val resource = ProofResource(conversationId = "33333333-3333-4333-8333-333333333333")
    private val request = DeviceProofRequest(
        version = 1, requestId = "request", accountIdentityReference = "account", deviceId = "device",
        deviceIdentityReference = "identity", operation = "relay:message", nonce = "nonce", epoch = 4,
        resource = resource, createdAt = 10_000, expiresAt = 40_000, signature = "request-signature", canonicalUnsignedJson = "{}",
    )
    private fun proof(
        operation: String = request.operation,
        proofResource: ProofResource? = resource,
        expiry: Long = 30_000,
        epoch: Long = request.epoch,
    ) = DeviceAuthorizationProof(1, "proof", "account", "device", "identity", operation, epoch, "nonce", proofResource, 10_000, expiry, "backend-signature")

    @Test fun `fresh proof must match device account operation epoch nonce and resource`() {
        assertEquals(request.nonce, validateIssuedProof(proof(), request, 15_000).proofNonce)
        assertThrows(IllegalArgumentException::class.java) { validateIssuedProof(proof(operation = "device-control"), request, 15_000) }
        assertThrows(IllegalArgumentException::class.java) { validateIssuedProof(proof(proofResource = ProofResource(conversationId = "other")), request, 15_000) }
        assertThrows(IllegalArgumentException::class.java) { validateIssuedProof(proof(epoch = 3), request, 15_000) }
        assertThrows(IllegalArgumentException::class.java) { validateIssuedProof(proof(expiry = 15_000), request, 15_000) }
    }

    @Test fun `proof validation tolerates only bounded server clock skew`() {
        assertEquals(request.nonce, validateIssuedProof(proof(expiry = 30_000), request, 9_000).proofNonce)
        val tooFarAhead = proof(expiry = 60_001).copy(issuedAt = 40_001, expiresAt = 60_001)
        assertThrows(IllegalArgumentException::class.java) { validateIssuedProof(tooFarAhead, request, 10_000) }
    }
}
