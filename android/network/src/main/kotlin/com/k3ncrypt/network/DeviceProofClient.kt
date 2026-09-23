package com.k3ncrypt.network

import com.k3ncrypt.crypto.AccountHandle
import com.k3ncrypt.crypto.CryptoPort
import com.k3ncrypt.security.ProofResource
import java.util.UUID

data class DeviceProofRequest(
    val version: Int = 1, val requestId: String, val accountIdentityReference: String, val deviceId: String,
    val deviceIdentityReference: String, val operation: String, val nonce: String, val epoch: Long,
    val resource: ProofResource?, val createdAt: Long, val expiresAt: Long, val signature: String,
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
        return DeviceProofRequest(1, requestId, accountRef, deviceId, identityRef, operation, nonce, epoch, resource, createdAt, expiresAt, crypto.signControlEvent(account, unsigned.encodeToByteArray()))
    }
}
