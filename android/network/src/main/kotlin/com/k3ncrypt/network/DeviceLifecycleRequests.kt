package com.k3ncrypt.network

import com.k3ncrypt.crypto.AccountHandle
import com.k3ncrypt.crypto.CryptoPort
import java.util.UUID

data class SignedControlEvent(val canonicalUnsignedJson: String, val signature: String)

internal fun signedControlWireJson(canonicalUnsignedJson: String, signature: String): String {
    require(canonicalUnsignedJson.startsWith("{") && canonicalUnsignedJson.endsWith("}"))
    return canonicalUnsignedJson.removeSuffix("}") + ",\"signature\":" + org.json.JSONObject.quote(signature) + "}"
}

/** Builds only the Phase 8 field order; server authority remains the verifier. */
class DeviceLifecycleRequests(private val crypto: CryptoPort, private val now: () -> Long = { System.currentTimeMillis() }) {
    private fun sign(account: AccountHandle, fields: List<Pair<String, Any?>>): SignedControlEvent {
        val unsigned = CanonicalJson.objectOf(fields)
        return SignedControlEvent(unsigned, crypto.signControlEvent(account, unsigned.encodeToByteArray()))
    }
    fun bootstrap(account: AccountHandle, requestId: String, deviceId: String, identityReference: String, verificationKey: String, fingerprint: String): SignedControlEvent {
        val created = now()
        return sign(account, listOf("version" to 1, "requestId" to requestId, "deviceId" to deviceId, "deviceIdentityReference" to identityReference, "verificationKey" to verificationKey, "fingerprint" to fingerprint, "createdAt" to created, "expiresAt" to created + 30_000, "nonce" to UUID.randomUUID().toString().replace("-", "")))
    }
    fun enrollment(account: AccountHandle, eventId: String, accountRef: String, issuerDeviceId: String, issuerIdentity: String, issuerEpoch: Long, targetDeviceId: String, targetIdentity: String, targetVerificationKey: String, targetFingerprint: String): SignedControlEvent {
        val created = now()
        return sign(account, listOf("version" to 1, "eventId" to eventId, "accountIdentityReference" to accountRef, "issuerDeviceId" to issuerDeviceId, "issuerIdentityReference" to issuerIdentity, "issuerEpoch" to issuerEpoch, "targetDeviceId" to targetDeviceId, "targetIdentityReference" to targetIdentity, "targetVerificationKey" to targetVerificationKey, "targetFingerprint" to targetFingerprint, "nonce" to UUID.randomUUID().toString().replace("-", ""), "createdAt" to created, "expiresAt" to created + 30_000))
    }
    fun activationOrRevocation(account: AccountHandle, eventId: String, accountRef: String, issuerDeviceId: String, issuerIdentity: String, targetDeviceId: String, targetIdentity: String, operation: String, previousEpoch: Long): SignedControlEvent {
        require(operation == "activate" || operation == "revoke")
        val created = now()
        return sign(account, listOf("version" to 1, "eventId" to eventId, "accountIdentityReference" to accountRef, "issuerDeviceId" to issuerDeviceId, "issuerIdentityReference" to issuerIdentity, "targetDeviceId" to targetDeviceId, "targetIdentityReference" to targetIdentity, "operation" to operation, "previousEpoch" to previousEpoch, "nextEpoch" to previousEpoch + 1, "createdAt" to created, "expiresAt" to created + 30_000))
    }
}
