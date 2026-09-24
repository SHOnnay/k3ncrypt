package com.k3ncrypt.app

import com.k3ncrypt.crypto.CryptoPort
import com.k3ncrypt.crypto.IdentityFingerprint
import com.k3ncrypt.crypto.SessionHandle
import com.k3ncrypt.messaging.ConversationSessionStore
import com.k3ncrypt.messaging.DeliveryAcceptance
import com.k3ncrypt.messaging.DeviceTrustVerifier
import com.k3ncrypt.messaging.InboundMessageProcessor
import com.k3ncrypt.messaging.MailboxDelivery
import com.k3ncrypt.messaging.MessageFrame
import com.k3ncrypt.messaging.PickleKeyProvider
import com.k3ncrypt.messaging.SenderBundle
import com.k3ncrypt.messaging.SenderBundleResolver
import com.k3ncrypt.messaging.VolatileCryptoStateInvalidator
import com.k3ncrypt.network.DeviceProofClient
import com.k3ncrypt.network.DeviceProofIdentity
import com.k3ncrypt.network.K3ncryptApi
import com.k3ncrypt.network.RelayJoin
import com.k3ncrypt.network.RelayCallSignal
import com.k3ncrypt.network.SocketRelay
import com.k3ncrypt.network.awaitConnected
import com.k3ncrypt.network.joinAndReplay
import com.k3ncrypt.network.sendEnvelopeAwait
import com.k3ncrypt.network.sendCallSignalAwait
import com.k3ncrypt.network.VodozemacBundleCodec
import com.k3ncrypt.security.ProofResource
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.PickleKeyVault
import com.k3ncrypt.storage.SessionState
import com.k3ncrypt.storage.StoredOutboundMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.UUID
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

data class ConversationInvitation(
    val conversationId: String,
    val localRoutingId: String,
    val peerRoutingId: String,
    val peerIdentityReference: String,
    val controlCapability: String,
    val routingProof: String,
)

/** Safe UI metadata for choosing a previously saved conversation. */
data class SavedConversationSummary(
    val conversationHash: String,
    val trustState: String,
    val connectionState: String,
    val deliveryState: String,
    val lastActivityTimestamp: Long,
)

internal object SavedConversationIndex {
    fun hash(conversationId: String): String = MessageDigest.getInstance("SHA-256").digest(conversationId.encodeToByteArray())
        .joinToString("") { "%02x".format(it) }

    fun isTrusted(invitation: ConversationInvitation): Boolean =
        invitation.peerRoutingId.isNotEmpty() && invitation.peerIdentityReference.isNotEmpty()

    fun selectTrusted(targetHash: String, invitations: List<ConversationInvitation>): ConversationInvitation? =
        invitations.firstOrNull { isTrusted(it) && hash(it.conversationId) == targetHash }
}

data class AndroidChatMessage(val id: String, val conversationId: String, val senderRoutingId: String, val text: String, val timestamp: Long)

/** Connected Phase 9.2 messaging path. All trust and key verification is fail-closed at injected pin boundaries. */
class AndroidMessagingRepository(
    private val identity: AndroidIdentityLifecycleRepository,
    private val crypto: CryptoPort,
    private val stateStore: CryptoStateStore,
    private val pickleKeys: PickleKeyVault,
    private val api: K3ncryptApi,
    private val proofs: DeviceProofClient,
    private val relay: SocketRelay,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()
    private val sessions = NativeSessionRegistry(crypto, stateStore)
    @Volatile private var conversation: ConversationInvitation? = null
    private var observer: ((AndroidChatMessage) -> Unit)? = null
    private var peerIdentityObserver: ((String, String) -> Unit)? = null
    @Volatile private var callSignalObserver: ((String) -> Unit)? = null
    private val firstContactCandidates = ConcurrentHashMap<String, String>()

    init {
        relay.onCallSignal { signal -> scope.launch { receiveCallSignal(signal) } }
        relay.onDelivery { delivery, acknowledge ->
            scope.launch {
                if (BuildConfig.DEBUG) DebugInspectionStore.setDeliveryStage("mailbox-received")
                val binding = conversation
                if (binding == null || binding.conversationId != delivery.conversationId) { acknowledge(false); return@launch }
                val accepted = receive(binding, delivery)
                acknowledge(accepted)
                if (BuildConfig.DEBUG && accepted) DebugInspectionStore.setDeliveryStage("acknowledgement")
            }
        }
    }

    fun observeCallSignals(observer: (String) -> Unit) { callSignalObserver = observer }
    suspend fun activeConversation(): ConversationInvitation = mutex.withLock { conversation?.takeIf(SavedConversationIndex::isTrusted) ?: error("A verified conversation is required for calls") }

    /** Encrypts through the existing Olm/Vodozemac session, commits the mutated session, then signals through the proof-checked relay. */
    suspend fun sendCallSignal(plaintext: String) = mutex.withLock {
        val binding = conversation ?: error("Call conversation is unavailable")
        require(binding.peerRoutingId.isNotEmpty() && binding.peerIdentityReference.startsWith("K3 ")) { "Verified contact is required for calls" }
        require(plaintext.toByteArray(Charsets.UTF_8).size in 1..65_536) { "Call signal is malformed" }
        val local = identity.activeState()
        val account = identity.activeAccount()
        val session = sessions.existing(binding.peerRoutingId) ?: error("An established encrypted conversation session is required before calling")
        val bytes = plaintext.toByteArray(Charsets.UTF_8)
        var mutated = false
        try {
            val encrypted = crypto.encrypt(session, bytes)
            mutated = true
            val pickleKey = pickleKeys.load(local.deviceIdentityReference)
            try {
                val accountPickle = crypto.saveAccount(account, pickleKey)
                val sessionPickle = crypto.saveSession(session)
                try { stateStore.commitAccountAndSession(local.deviceIdentityReference, accountPickle, SessionState(binding.peerRoutingId, sessionPickle)) }
                finally { sessionPickle.fill(0) }
            } finally { pickleKey.fill(0) }
            sessions.remember(binding.peerRoutingId, session)
            val envelope = JSONObject().put("version", 2).put("strategy", "vodozemac-olm-v1")
                .put("data", JSONObject().put("version", 1).put("olmMessage", encrypted)).toString()
            val proof = proofs.acquire(account, local.toProofIdentity(), "relay:signal", ProofResource(conversationId = binding.conversationId))
            if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("proof-issued")
            relay.awaitConnected()
            if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("relay-connected")
            relay.sendCallSignalAwait(envelope, proof) {
                if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("signal-sent")
            }
            if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("signal-ack")
        } catch (error: Throwable) {
            if (mutated) runCatching { invalidateAfterMutation() }
            throw error
        } finally { bytes.fill(0) }
    }

    private suspend fun receiveCallSignal(signal: RelayCallSignal) = mutex.withLock {
        val binding = conversation ?: return@withLock
        if (binding.conversationId != signal.conversationId || binding.peerRoutingId.isEmpty()) return@withLock
        val current = identity.activeState()
        val account = identity.activeAccount()
        var session: SessionHandle? = null
        var mutated = false
        var plaintext: ByteArray? = null
        try {
            val wire = com.k3ncrypt.messaging.EncryptedEnvelopeParser.parse(signal.envelope)
            session = sessions.existing(binding.peerRoutingId)
            require(session != null) { "Established encrypted conversation session is required for calls" }
            plaintext = crypto.decrypt(session, wire.olmMessage)
            mutated = true
            val pickleKey = pickleKeys.load(current.deviceIdentityReference)
            try {
                val accountPickle = crypto.saveAccount(account, pickleKey)
                val sessionPickle = crypto.saveSession(session!!)
                try { stateStore.commitAccountAndSession(current.deviceIdentityReference, accountPickle, SessionState(binding.peerRoutingId, sessionPickle)) }
                finally { sessionPickle.fill(0) }
            } finally { pickleKey.fill(0) }
            sessions.remember(binding.peerRoutingId, session!!)
            mutated = false
            callSignalObserver?.invoke(plaintext!!.decodeToString())
            if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("signal-received")
        } catch (_: Throwable) {
            if (mutated) { session?.let { runCatching { crypto.closeSession(it) } }; runCatching { invalidateAfterMutation() } }
        } finally { plaintext?.fill(0) }
    }

    /** Creates a local conversation only from an existing authenticated invitation and pinned peer identity. */
    suspend fun createConversation(invitation: ConversationInvitation, userConfirmedPeerFingerprint: String?): ConversationInvitation {
        validateInvitation(invitation)
        if (invitation.peerRoutingId.isNotEmpty()) {
            require(userConfirmedPeerFingerprint == invitation.peerIdentityReference) { "Peer identity confirmation did not match" }
            VodozemacBundleCodec.parse(api.fetchPrekeys(invitation.conversationId, invitation.controlCapability, invitation.peerRoutingId), userConfirmedPeerFingerprint)
        } else require(userConfirmedPeerFingerprint == null && invitation.peerIdentityReference.isEmpty())
        val existing = stateStore.read("conversation", invitation.conversationId)
        if (existing != null) {
            val restored = parseInvitation(existing.decodeToString())
            val isExplicitFirstContactPin = restored.peerRoutingId.isEmpty() && invitation.peerRoutingId.isNotEmpty() &&
                restored.copy(peerRoutingId = invitation.peerRoutingId, peerIdentityReference = invitation.peerIdentityReference) == invitation &&
                firstContactCandidates[invitation.peerRoutingId] == invitation.peerIdentityReference
            require(restored == invitation || isExplicitFirstContactPin) { "Conversation identity or routing changed" }
            if (isExplicitFirstContactPin) {
                stateStore.write("conversation", invitation.conversationId, invitationJson(invitation).toString().encodeToByteArray())
                selectActiveConversation(invitation.conversationId)
                return invitation
            }
            selectActiveConversation(restored.conversationId)
            return restored
        }
        stateStore.write("conversation", invitation.conversationId, invitationJson(invitation).toString().toByteArray(Charsets.UTF_8))
        selectActiveConversation(invitation.conversationId)
        return invitation
    }

    /** Authenticates relay admission, installs the receive handler, then asks for mailbox replay. */
    suspend fun connect(invitation: ConversationInvitation, userConfirmedPeerFingerprint: String?, onMessage: (AndroidChatMessage) -> Unit, onPeerIdentityPending: (String, String) -> Unit = { _, _ -> }) {
        var stage = "publish_prekeys"
        DebugInspectionStore.setConnectionStage(stage)
        try {
            val localPublication = identity.publishPrekeys(invitation.conversationId, invitation.controlCapability)
            require(localPublication.getString("address") == invitation.localRoutingId) { "Local routing identity does not match this device's published pre-key bundle" }
            stage = "conversation_validation"; DebugInspectionStore.setConnectionStage(stage)
            val binding = createConversation(invitation, userConfirmedPeerFingerprint)
            val local = identity.activeState()
            mutex.withLock { conversation = binding; observer = onMessage; peerIdentityObserver = onPeerIdentityPending }
            stage = "relay_connect"; DebugInspectionStore.setConnectionStage(stage)
            if (!relay.connected.value) relay.connect()
            relay.awaitConnected()
            stage = "proof_request"; DebugInspectionStore.setConnectionStage(stage)
            val proof = proofs.acquire(identity.activeAccount(), local.toProofIdentity(), "relay:message", ProofResource(conversationId = binding.conversationId))
            stage = "relay_join"; DebugInspectionStore.setConnectionStage(stage)
            // Do not hold the crypto/session lock while replay waits for client acceptance.
            relay.joinAndReplay(RelayJoin(binding.localRoutingId, binding.conversationId, binding.controlCapability, binding.routingProof, proof))
            stage = "joined"; DebugInspectionStore.setConnectionStage(stage)
            mutex.withLock { retryPending(binding) }
        } catch (error: Throwable) {
            val category = when {
                error.message?.startsWith("request-rejected-") == true -> "http_rejected"
                error.message == "request-failed" -> "http_unavailable"
                else -> "failed"
            }
            DebugInspectionStore.setConnectionStage("${stage}_$category")
            throw error
        }
    }

    /** Creates a private room invitation. First-contact message acceptance stays blocked until the user confirms its fingerprint. */
    suspend fun createNewConversation(onMessage: (AndroidChatMessage) -> Unit, onPeerIdentityPending: (String, String) -> Unit): ConversationInvitation {
        val randomCapability = ByteArray(32).also(SecureRandom()::nextBytes)
        val capability = Base64.getUrlEncoder().withoutPadding().encodeToString(randomCapability)
        randomCapability.fill(0)
        val capabilityHash = MessageDigest.getInstance("SHA-256").digest(capability.encodeToByteArray()).joinToString("") { "%02x".format(it) }
        val conversationId = api.createChatLink(capabilityHash).getString("hash")
        val local = identity.publishPrekeys(conversationId, capability)
        val invitation = ConversationInvitation(conversationId, local.getString("address"), "", "", capability, local.getString("renewalProof"))
        connect(invitation, null, onMessage, onPeerIdentityPending)
        return invitation
    }

    suspend fun restoreConversation(): ConversationInvitation? {
        val activeId = stateStore.read("conversation-active", "selected")?.let { bytes ->
            try { bytes.decodeToString() } finally { bytes.fill(0) }
        }
        if (activeId != null) {
            stateStore.read("conversation", activeId)?.let { bytes ->
                return try { parseInvitation(bytes.decodeToString()) } finally { bytes.fill(0) }
            }
        }
        // Migration-safe fallback for records created before the active pointer.
        return stateStore.list("conversation").firstOrNull()?.let { (_, bytes) ->
            try { parseInvitation(bytes.decodeToString()) } finally { bytes.fill(0) }
        }
    }

    /** Lists saved records without exposing routing IDs, capabilities, proofs, or fingerprints to the UI. */
    suspend fun savedTrustedConversations(): List<SavedConversationSummary> {
        val activeId = stateStore.read("conversation-active", "selected")?.let { bytes ->
            try { bytes.decodeToString() } finally { bytes.fill(0) }
        }
        val lastActivityByConversation = stateStore.messages().groupBy { it.conversationId }
            .mapValues { (_, messages) -> messages.maxOfOrNull { it.receivedAt } ?: 0L }
        return stateStore.list("conversation").mapNotNull { (_, bytes) ->
            val invitation = try { parseInvitation(bytes.decodeToString()) } finally { bytes.fill(0) }
            if (!SavedConversationIndex.isTrusted(invitation)) return@mapNotNull null
            SavedConversationSummary(
                conversationHash = SavedConversationIndex.hash(invitation.conversationId),
                trustState = "verified",
                connectionState = if (invitation.conversationId == activeId && relay.connected.value) "connected" else "saved",
                deliveryState = if (lastActivityByConversation[invitation.conversationId]?.let { it > 0L } == true) "has_messages" else "empty",
                lastActivityTimestamp = lastActivityByConversation[invitation.conversationId] ?: 0L,
            )
        }.sortedWith(compareByDescending<SavedConversationSummary> { it.lastActivityTimestamp }.thenBy { it.conversationHash })
    }

    /** Reopens only a persisted, identity-pinned conversation selected by its non-secret stable hash. */
    suspend fun selectSavedTrustedConversation(
        conversationHash: String,
        onMessage: (AndroidChatMessage) -> Unit,
        onPeerIdentityPending: (String, String) -> Unit,
    ): ConversationInvitation {
        val saved = stateStore.list("conversation").map { (_, bytes) ->
            try { parseInvitation(bytes.decodeToString()) } finally { bytes.fill(0) }
        }
        val invitation = SavedConversationIndex.selectTrusted(conversationHash, saved)
            ?: error("Saved trusted conversation is unavailable")
        connect(invitation, invitation.peerIdentityReference, onMessage, onPeerIdentityPending)
        return invitation
    }

    suspend fun confirmFirstContact(route: String, fingerprint: String, onMessage: (AndroidChatMessage) -> Unit, onPeerIdentityPending: (String, String) -> Unit) {
        require(firstContactCandidates[route] == fingerprint) { "Peer identity confirmation did not match the observed key" }
        val current = conversation ?: error("No conversation is active")
        require(current.peerRoutingId.isEmpty()) { "Conversation already has a pinned peer" }
        connect(current.copy(peerRoutingId = route, peerIdentityReference = fingerprint), fingerprint, onMessage, onPeerIdentityPending)
        firstContactCandidates.remove(route)
    }

    suspend fun sendText(text: String): String {
        var stage = "conversation"
        DebugInspectionStore.setDeliveryStage("send_started")
        return try {
            sendTextInternal(text) { stage = it; DebugInspectionStore.setDeliveryStage(it) }
        } catch (error: Throwable) {
            DebugInspectionStore.setDeliveryStage("send_failed_$stage")
            throw error
        }
    }

    private suspend fun sendTextInternal(text: String, setStage: (String) -> Unit): String = mutex.withLock {
        val binding = conversation ?: error("Conversation is not connected")
        require(binding.peerRoutingId.isNotEmpty()) { "Confirm the peer identity before sending" }
        require(text.isNotBlank() && text.toByteArray(Charsets.UTF_8).size <= 64 * 1024) { "Message is empty or too large" }
        val local = identity.activeState()
        val account = identity.activeAccount()
        setStage("proof_request")
        val proof = proofs.acquire(account, local.toProofIdentity(), "relay:message", ProofResource(conversationId = binding.conversationId))
        setStage("prekey_session")
        val session = sessions.existing(binding.peerRoutingId) ?: newOutboundSession(binding, setStage)
        setStage("vodozemac_encrypt")
        val frame = MessageFrame.encodeText(text)
        val clientId = UUID.randomUUID().toString()
        var mutated = false
        try {
            val olm = crypto.encrypt(session, frame)
            mutated = true
            val envelope = JSONObject().put("version", 2).put("strategy", "vodozemac-olm-v1")
                .put("data", JSONObject().put("version", 1).put("olmMessage", olm)).toString()
            val pickleKey = pickleKeys.load(local.deviceIdentityReference)
            try {
                val accountPickle = crypto.saveAccount(account, pickleKey)
                val sessionPickle = crypto.saveSession(session)
                try {
                setStage("room_persistence")
                stateStore.commitOutbound(
                    local.deviceIdentityReference, accountPickle,
                    SessionState(binding.peerRoutingId, sessionPickle), clientId, envelope,
                    StoredOutboundMessage(clientId, binding.conversationId, binding.localRoutingId, binding.peerRoutingId, text, System.currentTimeMillis()),
                )
                } finally { sessionPickle.fill(0) }
            } finally { pickleKey.fill(0) }
            sessions.remember(binding.peerRoutingId, session)
            setStage("relay_ack")
            val receipt = relay.sendEnvelopeAwait(envelope, binding.peerRoutingId, proof)
            setStage("accepted")
            stateStore.acknowledgeOutbound(clientId)
            observer?.invoke(AndroidChatMessage(clientId, binding.conversationId, binding.localRoutingId, text, receipt.timestamp))
            clientId
        } catch (error: Throwable) {
            if (mutated && stateStore.pendingOutbox().none { it.first == clientId }) invalidateAfterMutation()
            throw error
        } finally { frame.fill(0) }
    }

    suspend fun messages(): List<AndroidChatMessage> = stateStore.messages().map { AndroidChatMessage(it.deliveryId, it.conversationId, it.senderRoutingId, it.text, it.receivedAt) }

    suspend fun disconnect() { conversation = null; relay.close() }

    private suspend fun retryPending(binding: ConversationInvitation) {
        val pending = stateStore.pendingOutbox()
        pending.forEach { (id, serialized) ->
            val payload = JSONObject(serialized)
            if (payload.getString("conversationId") != binding.conversationId || payload.getString("peerRoutingId") != binding.peerRoutingId) return@forEach
            val local = identity.activeState()
            val proof = proofs.acquire(identity.activeAccount(), local.toProofIdentity(), "relay:message", ProofResource(conversationId = binding.conversationId))
            relay.sendEnvelopeAwait(payload.getString("envelope"), binding.peerRoutingId, proof)
            stateStore.acknowledgeOutbound(id)
        }
    }

    private suspend fun receive(binding: ConversationInvitation, item: com.k3ncrypt.network.RelayDelivery): Boolean = mutex.withLock {
        try {
            if (binding.peerRoutingId.isEmpty()) {
                if (BuildConfig.DEBUG) DebugInspectionStore.setDeliveryStage("trust-check")
                require(item.sender.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")))
                val candidate = VodozemacBundleCodec.parse(api.fetchPrekeys(binding.conversationId, binding.controlCapability, item.sender), null)
                val fingerprint = IdentityFingerprint.generate(candidate.identity)
                firstContactCandidates[item.sender] = fingerprint
                peerIdentityObserver?.invoke(item.sender, fingerprint)
                return@withLock false
            }
            val current = identity.activeState()
            val account = identity.activeAccount()
            val resolver = SenderBundleResolver { sender ->
                require(sender == binding.peerRoutingId) { "Unknown conversation sender" }
                val remote = VodozemacBundleCodec.parse(api.fetchPrekeys(binding.conversationId, binding.controlCapability, sender), binding.peerIdentityReference)
                SenderBundle(remote.identity.curve25519)
            }
            val trust = DeviceTrustVerifier { sender, senderIdentity ->
                require(sender == binding.peerRoutingId) { "Unknown sender route" }
                val remote = VodozemacBundleCodec.parse(api.fetchPrekeys(binding.conversationId, binding.controlCapability, sender), binding.peerIdentityReference)
                require(remote.identity.curve25519 == senderIdentity && IdentityFingerprint.generate(remote.identity) == binding.peerIdentityReference) { "Sender identity mismatch" }
            }
            val processor = InboundMessageProcessor(
                account = account,
                accountId = current.deviceIdentityReference,
                crypto = crypto,
                cryptoState = stateStore,
                bundles = resolver,
                trust = trust,
                sessions = sessions,
                pickleKeys = PickleKeyProvider { pickleKeys.load(current.deviceIdentityReference) },
                invalidator = VolatileCryptoStateInvalidator { invalidateAfterMutation() },
                diagnosticStage = { stage -> if (BuildConfig.DEBUG) DebugInspectionStore.setDeliveryStage(stage) },
            )
            when (val result = processor.receive(MailboxDelivery(item.id, item.sender, item.envelope, item.conversationId))) {
                DeliveryAcceptance.Accepted -> {
                    stateStore.messages().lastOrNull { it.deliveryId == item.id }?.let { observer?.invoke(AndroidChatMessage(it.deliveryId, it.conversationId, it.senderRoutingId, it.text, it.receivedAt)) }
                    true
                }
                DeliveryAcceptance.Duplicate -> true
                is DeliveryAcceptance.Rejected -> false
            }
        } catch (_: Exception) { false }
    }

    private suspend fun newOutboundSession(binding: ConversationInvitation, setStage: (String) -> Unit = {}): SessionHandle {
        setStage("fetch_peer_prekeys")
        val bundle = api.fetchPrekeys(binding.conversationId, binding.controlCapability, binding.peerRoutingId)
        setStage("validate_peer_bundle")
        val public = VodozemacBundleCodec.parse(bundle, binding.peerIdentityReference)
        val oneTimeKeyId = public.oneTimeKeyId
        val claimed = if (oneTimeKeyId != null) {
            setStage("claim_peer_prekey")
            val key = api.claimPrekey(binding.conversationId, binding.controlCapability, binding.peerRoutingId, oneTimeKeyId)
            require(key.getString("id") == oneTimeKeyId && key.getString("key") == public.oneTimeKey) { "Claimed pre-key does not match verified bundle" }
            key.getString("key")
        } else public.fallbackKey ?: error("Recipient has no usable pre-key")
        setStage("create_outbound_session")
        return crypto.createOutboundSession(
            identity.activeAccount(),
            VodozemacBundleCodec.toNativeBase64(public.identity.curve25519),
            VodozemacBundleCodec.toNativeBase64(claimed),
        )
    }

    private suspend fun invalidateAfterMutation() {
        sessions.clear()
        identity.invalidateVolatileIdentity()
    }

    private fun validateInvitation(value: ConversationInvitation) {
        require(isUuid(value.conversationId) && isUuid(value.localRoutingId))
        require(value.peerRoutingId.isEmpty() || isUuid(value.peerRoutingId))
        require((value.peerRoutingId.isEmpty() && value.peerIdentityReference.isEmpty()) || (value.localRoutingId != value.peerRoutingId && value.peerIdentityReference.startsWith("K3 ")))
        require(value.controlCapability.isNotBlank() && value.routingProof.matches(Regex("[A-Za-z0-9_-]{43}")))
    }

    private fun invitationJson(value: ConversationInvitation) = JSONObject().put("conversationId", value.conversationId).put("localRoutingId", value.localRoutingId)
        .put("peerRoutingId", value.peerRoutingId).put("peerIdentityReference", value.peerIdentityReference).put("controlCapability", value.controlCapability).put("routingProof", value.routingProof)

    private suspend fun selectActiveConversation(conversationId: String) {
        stateStore.write("conversation-active", "selected", conversationId.encodeToByteArray())
    }

    private fun parseInvitation(value: String) = JSONObject(value).let { ConversationInvitation(it.getString("conversationId"), it.getString("localRoutingId"), it.getString("peerRoutingId"), it.getString("peerIdentityReference"), it.getString("controlCapability"), it.getString("routingProof")) }
    private fun isUuid(value: String) = runCatching { UUID.fromString(value).toString() == value.lowercase() }.getOrDefault(false)
    private fun AndroidIdentityState.toProofIdentity() = DeviceProofIdentity(accountIdentityReference ?: error("Unbound device"), deviceId, deviceIdentityReference, trustEpoch)

    private class NativeSessionRegistry(private val crypto: CryptoPort, private val state: CryptoStateStore) : ConversationSessionStore {
        private val active = ConcurrentHashMap<String, SessionHandle>()
        override suspend fun existing(senderRoutingId: String): SessionHandle? = active[senderRoutingId] ?: state.read("session", senderRoutingId)?.let { bytes ->
            try {
                crypto.loadSession(bytes).also {
                    active[senderRoutingId] = it
                }
            } finally { bytes.fill(0) }
        }
        override suspend fun remember(senderRoutingId: String, session: SessionHandle) { active.put(senderRoutingId, session)?.takeIf { it != session }?.let(crypto::closeSession) }
        suspend fun clear() { active.values.forEach(crypto::closeSession); active.clear() }
    }
}
