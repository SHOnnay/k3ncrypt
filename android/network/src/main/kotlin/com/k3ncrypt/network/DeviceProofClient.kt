package com.k3ncrypt.network

import com.k3ncrypt.crypto.AccountHandle
import com.k3ncrypt.crypto.CryptoPort
import com.k3ncrypt.security.ProofResource
import com.k3ncrypt.security.DeviceAuthorizationProof
import com.k3ncrypt.security.ProofCarrier
import java.util.UUID

data class DeviceProofRequest(
    val version: Int = 1, val requestId: String, val accountIdentityReference: String, val deviceId: String,
    val deviceIdentityReference: String, val operation: String, val nonce: String, val epoch: Long,
    val resource: ProofResource?, val createdAt: Long, val expiresAt: Long, val signature: String, val canonicalUnsignedJson: String,
)

class DeviceProofRequestFactory(private val crypto: CryptoPort, private val now: () -> Long = { System.currentTimeMillis() }) {
    fun create(account: AccountHandle, accountRef: String, deviceId: String, identityRef: String, operation: String, epoch: Long, resource: ProofResource? = null): DeviceProofRequest {
        val createdAt = now(); val expiresAt = createdAt + 30_000; val requestId = UUID.randomUUID().toString(); val nonce = UUID.randomUUID().toString().replace("-", "")
        val resourceMap = resource?.let { linkedMapOf<String, Any?>().apply { it.conversationId?.let { value -> put("conversationId", value) }; it.networkId?.let { value -> put("networkId", value) }; it.attachmentId?.let { value -> put("attachmentId", value) }; it.bridgeRouteId?.let { value -> put("bridgeRouteId", value) } } }
        val unsigned = CanonicalJson.objectOf(listOf(
            "version" to 1, "requestId" to requestId, "accountIdentityReference" to accountRef, "deviceId" to deviceId,
            "deviceIdentityReference" to identityRef, "operation" to operation, "nonce" to nonce, "epoch" to epoch,
            "resource" to resourceMap, "createdAt" to createdAt, "expiresAt" to expiresAt,
        ))
        return DeviceProofRequest(1, requestId, accountRef, deviceId, identityRef, operation, nonce, epoch, resource, createdAt, expiresAt, crypto.signControlEvent(account, unsigned.encodeToByteArray()), unsigned)
    }
}

/** Requests a fresh one-time authorization for each protected operation. */
class DeviceProofClient(private val crypto: CryptoPort, private val api: K3ncryptApi, private val now: () -> Long = { System.currentTimeMillis() }) {
    suspend fun acquire(account: AccountHandle, identity: DeviceProofIdentity, operation: String, resource: ProofResource? = null): com.k3ncrypt.security.ProofCarrier {
        val request = DeviceProofRequestFactory(crypto, now).create(account, identity.accountIdentityReference, identity.deviceId, identity.deviceIdentityReference, operation, identity.epoch, resource)
        return api.issueProof(request)
    }
}

/** Client-side response binding check. Backend HMAC verification remains authoritative. */
internal fun validateIssuedProof(proof: DeviceAuthorizationProof, request: DeviceProofRequest, now: Long): ProofCarrier {
    require(proof.accountIdentityReference == request.accountIdentityReference && proof.deviceId == request.deviceId &&
        proof.deviceIdentityReference == request.deviceIdentityReference) { "Device proof response rejected: identity-binding" }
    require(proof.operation == request.operation && proof.trustEpoch == request.epoch) { "Device proof response rejected: operation-or-epoch" }
    require(proof.nonce == request.nonce) { "Device proof response rejected: nonce-binding" }
    require(proof.resource == request.resource) { "Device proof response rejected: resource-binding" }
    // The backend is the proof issuer and enforces expiry. Permit a bounded
    // server-ahead clock skew while still rejecting expired or long-lived proofs.
    require(proof.issuedAt <= now + 30_000 && proof.expiresAt > now && proof.expiresAt - proof.issuedAt in 1..30_000) { "Device proof response rejected: time-window" }
    require(proof.signature.isNotBlank()) { "Device proof response rejected: signature-missing" }
    return ProofCarrier(proof, request.nonce)
}

data class DeviceProofIdentity(val accountIdentityReference: String, val deviceId: String, val deviceIdentityReference: String, val epoch: Long)
