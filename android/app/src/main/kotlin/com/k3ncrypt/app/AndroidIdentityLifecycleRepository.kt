package com.k3ncrypt.app

import com.k3ncrypt.crypto.AccountHandle
import com.k3ncrypt.crypto.CryptoPort
import com.k3ncrypt.crypto.IdentityFingerprint
import com.k3ncrypt.crypto.PublicIdentity
import com.k3ncrypt.network.DeviceLifecycleRequests
import com.k3ncrypt.network.DeviceProofClient
import com.k3ncrypt.network.DeviceProofIdentity
import com.k3ncrypt.network.K3ncryptApi
import com.k3ncrypt.network.SignedControlEvent
import com.k3ncrypt.network.VodozemacBundleCodec
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.PickleKeyVault
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.UUID

data class AndroidIdentityState(
    val accountIdentityReference: String?,
    val deviceId: String,
    val deviceIdentityReference: String,
    val trustEpoch: Long,
    val lifecycleState: String,
    val identity: PublicIdentity,
)

data class NewDeviceEnrollmentIdentity(val deviceId: String, val deviceIdentityReference: String, val verificationKey: String, val fingerprint: String)

/** Owns local account restoration and speaks only the existing signed backend lifecycle contracts. */
class AndroidIdentityLifecycleRepository(
    private val crypto: CryptoPort,
    private val store: CryptoStateStore,
    private val pickleKeys: PickleKeyVault,
    private val api: K3ncryptApi,
    private val lifecycleRequests: DeviceLifecycleRequests,
    private val proofClient: DeviceProofClient,
) {
    private val mutex = Mutex()
    private var handle: AccountHandle? = null
    private var state: AndroidIdentityState? = null
    private var savedBootstrap: SignedControlEvent? = null

    suspend fun createFirstDevice(): AndroidIdentityState = mutex.withLock {
        check(store.readIdentityCheckpoint() == null) { "A local device identity already exists" }
        val account = crypto.createAccount()
        try {
            val identity = crypto.identityKeys(account)
            val reference = IdentityFingerprint.generate(identity)
            val deviceId = UUID.randomUUID().toString()
            val key = pickleKeys.create(reference)
            try {
                val signed = lifecycleRequests.bootstrap(account, UUID.randomUUID().toString(), deviceId, reference, IdentityFingerprint.normalize(identity.ed25519), reference)
                val checkpoint = checkpoint(null, deviceId, reference, 0, "bootstrap-pending", identity, signed)
                store.persistIdentityCheckpoint(reference, crypto.saveAccount(account, key), checkpoint.toString().toByteArray(Charsets.UTF_8))
                savedBootstrap = signed
                val accepted = api.bootstrap(signed)
                require(accepted.getString("deviceId") == deviceId && accepted.getString("deviceIdentityReference") == reference)
                val accountReference = accepted.getString("accountIdentityReference")
                val epoch = accepted.getLong("trustEpoch")
                val active = AndroidIdentityState(accountReference, deviceId, reference, epoch, "active", identity)
                store.persistIdentityCheckpoint(reference, crypto.saveAccount(account, key), checkpoint(accountReference, deviceId, reference, epoch, "active", identity, null).toString().toByteArray(Charsets.UTF_8))
                savedBootstrap = null
                handle = account
                state = active
                active
            } finally { key.fill(0) }
        } catch (error: Throwable) {
            // Preserve the locally-created signed bootstrap checkpoint for same-device recovery; never mint a replacement identity silently.
            if (handle?.value != account.value) runCatching { crypto.closeAccount(account) }
            throw error
        }
    }

    /** Creates the target's independent Vodozemac identity before a trusted peer approves enrollment. */
    suspend fun createEnrollmentTarget(): NewDeviceEnrollmentIdentity = mutex.withLock {
        check(store.readIdentityCheckpoint() == null) { "A local device identity already exists" }
        val account = crypto.createAccount()
        try {
            val identity = crypto.identityKeys(account)
            val reference = IdentityFingerprint.generate(identity)
            val deviceId = UUID.randomUUID().toString()
            val key = pickleKeys.create(reference)
            try {
                val checkpoint = checkpoint(null, deviceId, reference, 0, "target-awaiting-approval", identity, null)
                store.persistIdentityCheckpoint(reference, crypto.saveAccount(account, key), checkpoint.toString().toByteArray(Charsets.UTF_8))
                handle = account
                state = AndroidIdentityState(null, deviceId, reference, 0, "target-awaiting-approval", identity)
                NewDeviceEnrollmentIdentity(deviceId, reference, IdentityFingerprint.normalize(identity.ed25519), reference)
            } finally { key.fill(0) }
        } catch (error: Throwable) { runCatching { crypto.closeAccount(account) }; throw error }
    }

    suspend fun restore(): AndroidIdentityState = mutex.withLock {
        state?.let { return@withLock it }
        val bytes = store.readIdentityCheckpoint() ?: throw IllegalStateException("No local identity is registered")
        val checkpoint = JSONObject(bytes.decodeToString())
        val recordId = checkpoint.getString("recordId")
        val lifecycle = checkpoint.getString("lifecycleState")
        val identity = PublicIdentity(checkpoint.getString("curve25519"), checkpoint.getString("ed25519"))
        val key = pickleKeys.load(recordId)
        val pickle = store.read("account", recordId)?.decodeToString() ?: throw IllegalStateException("Stored account is unavailable")
        val restored = try { crypto.loadAccount(pickle, key) } finally { key.fill(0) }
        val restoredIdentity = crypto.identityKeys(restored)
        require(IdentityFingerprint.generate(restoredIdentity) == checkpoint.getString("deviceIdentityReference")) { "Restored identity binding rejected" }
        val value = AndroidIdentityState(
            checkpoint.optString("accountIdentityReference").takeIf { it.isNotBlank() }, checkpoint.getString("deviceId"),
            checkpoint.getString("deviceIdentityReference"), checkpoint.getLong("trustEpoch"), lifecycle, restoredIdentity,
        )
        val bootstrap = checkpoint.optJSONObject("bootstrap")
        savedBootstrap = bootstrap?.let { SignedControlEvent(it.getString("canonicalUnsignedJson"), it.getString("signature")) }
        handle = restored
        state = value
        value
    }

    suspend fun retryPendingBootstrap(): AndroidIdentityState = mutex.withLock {
        val current = state ?: restoreUnlocked()
        check(current.lifecycleState == "bootstrap-pending" && current.accountIdentityReference == null)
        val signed = savedBootstrap ?: error("Signed bootstrap request is unavailable")
        val key = pickleKeys.load(current.deviceIdentityReference)
        try {
            val result = api.bootstrap(signed)
            val accountRef = result.getString("accountIdentityReference")
            val epoch = result.getLong("trustEpoch")
            val updated = current.copy(accountIdentityReference = accountRef, trustEpoch = epoch, lifecycleState = "active")
            store.persistIdentityCheckpoint(current.deviceIdentityReference, crypto.saveAccount(handle!!, key), checkpoint(accountRef, current.deviceId, current.deviceIdentityReference, epoch, "active", current.identity, null).toString().toByteArray(Charsets.UTF_8))
            state = updated
            savedBootstrap = null
            updated
        } finally { key.fill(0) }
    }

    suspend fun approveDevice(target: NewDeviceEnrollmentIdentity): JSONObject = mutex.withLock {
        val source = active()
        require(target.deviceId != source.deviceId && target.fingerprint == target.deviceIdentityReference &&
            target.deviceIdentityReference.startsWith("K3 ") && target.verificationKey.matches(Regex("[A-Za-z0-9_-]{43}")))
        val issuerProof = proofClient.acquire(handle!!, source.toProofIdentity(), "device-control")
        val event = lifecycleRequests.enrollment(handle!!, UUID.randomUUID().toString(), source.accountIdentityReference!!, source.deviceId, source.deviceIdentityReference, source.trustEpoch, target.deviceId, target.deviceIdentityReference, target.verificationKey, target.fingerprint)
        api.enroll(event, issuerProof)
    }

    /** Target-only signed pending→active transition after a trusted issuer has created its durable pending record. */
    suspend fun activateApprovedDevice(accountReference: String, pendingEpoch: Long): AndroidIdentityState = mutex.withLock {
        val current = state ?: restoreUnlocked()
        check(current.lifecycleState == "target-awaiting-approval" && current.accountIdentityReference == null)
        val event = lifecycleRequests.activationOrRevocation(handle!!, UUID.randomUUID().toString(), accountReference, current.deviceId, current.deviceIdentityReference, current.deviceId, current.deviceIdentityReference, "activate", pendingEpoch)
        val result = api.activate(event)
        require(result.getString("deviceId") == current.deviceId && result.getString("state") == "active" && result.getLong("trustEpoch") == pendingEpoch + 1)
        val key = pickleKeys.load(current.deviceIdentityReference)
        try {
            val active = current.copy(accountIdentityReference = accountReference, trustEpoch = result.getLong("trustEpoch"), lifecycleState = "active")
            store.persistIdentityCheckpoint(current.deviceIdentityReference, crypto.saveAccount(handle!!, key), checkpoint(accountReference, current.deviceId, current.deviceIdentityReference, active.trustEpoch, "active", current.identity, null).toString().toByteArray(Charsets.UTF_8))
            state = active
            active
        } finally { key.fill(0) }
    }

    suspend fun revokeDevice(targetDeviceId: String, targetIdentityReference: String): JSONObject = mutex.withLock {
        val issuer = active()
        require(targetDeviceId != issuer.deviceId)
        val proof = proofClient.acquire(handle!!, issuer.toProofIdentity(), "device-control")
        val event = lifecycleRequests.activationOrRevocation(handle!!, UUID.randomUUID().toString(), issuer.accountIdentityReference!!, issuer.deviceId, issuer.deviceIdentityReference, targetDeviceId, targetIdentityReference, "revoke", issuer.trustEpoch)
        api.revoke(event, proof)
    }

    /** Persists mutated Rust account state before publishing its public one-time prekeys. */
    suspend fun publishPrekeys(conversationId: String, controlCapability: String): JSONObject = mutex.withLock {
        val current = active()
        val account = handle!!
        val publicationId = "${current.deviceIdentityReference}:$conversationId"
        val previous = store.read("prekey-publication", publicationId)?.let { JSONObject(it.decodeToString()) }
        if (previous?.optString("state") == "published") {
            return@withLock JSONObject().put("address", previous.getString("address")).put("renewalProof", previous.getString("renewalProof"))
        }
        check(previous == null) { "Pre-key publication has an uncertain outcome; do not publish replacement keys automatically" }
        val key = pickleKeys.load(current.deviceIdentityReference)
        try {
            val bundle = VodozemacBundleCodec.publicBundle(crypto, account)
            store.persistAccount(current.deviceIdentityReference, crypto.saveAccount(account, key))
            // If the network result is lost, do not republish the same one-time keys under another address.
            store.write("prekey-publication", publicationId, JSONObject().put("state", "pending").put("bundleDigest", java.security.MessageDigest.getInstance("SHA-256").digest(bundle.toString().toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }).toString().toByteArray(Charsets.UTF_8))
            val result = api.publishPrekeys(conversationId, controlCapability, bundle)
            crypto.markKeysAsPublished(account)
            store.write("account", current.deviceIdentityReference, crypto.saveAccount(account, key).toByteArray(Charsets.UTF_8))
            store.write("prekey-publication", publicationId, JSONObject().put("state", "published").put("address", result.getString("address")).put("renewalProof", result.getString("renewalProof")).toString().toByteArray(Charsets.UTF_8))
            result
        } finally { key.fill(0) }
    }

    suspend fun activeAccount(): AccountHandle = mutex.withLock { active(); handle!! }
    suspend fun activeState(): AndroidIdentityState = mutex.withLock { active() }

    /** Invalidates a mutated in-memory ratchet after an uncommitted receive; next access must restore durable state. */
    suspend fun invalidateVolatileIdentity() = mutex.withLock {
        handle?.let { runCatching { crypto.closeAccount(it) } }
        handle = null
        state = null
    }

    private suspend fun active(): AndroidIdentityState {
        val current = state ?: restoreUnlocked()
        check(current.lifecycleState == "active" && current.accountIdentityReference != null) { "Device lifecycle is not active" }
        return current
    }

    private suspend fun restoreUnlocked(): AndroidIdentityState {
        // Avoid acquiring this repository mutex recursively from recovery operations.
        val bytes = store.readIdentityCheckpoint() ?: throw IllegalStateException("No local identity is registered")
        val checkpoint = JSONObject(bytes.decodeToString())
        val id = checkpoint.getString("recordId")
        val key = pickleKeys.load(id)
        val pickle = store.read("account", id)?.decodeToString() ?: throw IllegalStateException("Stored account is unavailable")
        val restored = try { crypto.loadAccount(pickle, key) } finally { key.fill(0) }
        val restoredIdentity = crypto.identityKeys(restored)
        require(IdentityFingerprint.generate(restoredIdentity) == checkpoint.getString("deviceIdentityReference"))
        val value = AndroidIdentityState(checkpoint.optString("accountIdentityReference").takeIf(String::isNotBlank), checkpoint.getString("deviceId"), checkpoint.getString("deviceIdentityReference"), checkpoint.getLong("trustEpoch"), checkpoint.getString("lifecycleState"), restoredIdentity)
        handle = restored; state = value
        checkpoint.optJSONObject("bootstrap")?.let { savedBootstrap = SignedControlEvent(it.getString("canonicalUnsignedJson"), it.getString("signature")) }
        return value
    }

    private fun AndroidIdentityState.toProofIdentity() = DeviceProofIdentity(accountIdentityReference ?: error("Account is not bound"), deviceId, deviceIdentityReference, trustEpoch)

    private fun checkpoint(accountRef: String?, deviceId: String, identityRef: String, epoch: Long, lifecycle: String, identity: PublicIdentity, bootstrap: SignedControlEvent?): JSONObject = JSONObject()
        .put("recordId", identityRef).put("accountIdentityReference", accountRef).put("deviceId", deviceId).put("deviceIdentityReference", identityRef)
        .put("trustEpoch", epoch).put("lifecycleState", lifecycle).put("curve25519", identity.curve25519).put("ed25519", identity.ed25519)
        .apply { bootstrap?.let { put("bootstrap", JSONObject().put("canonicalUnsignedJson", it.canonicalUnsignedJson).put("signature", it.signature)) } }

}
