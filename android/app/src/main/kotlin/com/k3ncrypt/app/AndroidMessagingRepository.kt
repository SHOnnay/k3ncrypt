package com.k3ncrypt.app

import com.k3ncrypt.crypto.CryptoPort
import com.k3ncrypt.crypto.IdentityFingerprint
import com.k3ncrypt.crypto.SessionHandle
import com.k3ncrypt.messaging.ConversationSessionStore
import com.k3ncrypt.messaging.DeliveryAcceptance
import com.k3ncrypt.messaging.DeviceTrustVerifier
import com.k3ncrypt.messaging.InboundMessageProcessor
import com.k3ncrypt.messaging.AuthenticatedControlFrameHandler
import com.k3ncrypt.messaging.InboundControlAcceptance
import com.k3ncrypt.messaging.JoinIntroduction
import com.k3ncrypt.messaging.JoinIntroductionFrame
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
import com.k3ncrypt.storage.SecureStateWrite
import com.k3ncrypt.storage.StoredOutboundMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collect
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
    val label: String,
    val trustState: String,
    val connectionState: String,
    val deliveryState: String,
    val lastActivityTimestamp: Long,
)

internal object SavedConversationIndex {
    fun hash(conversationId: String): String = MessageDigest.getInstance("SHA-256").digest(conversationId.encodeToByteArray())
        .joinToString("") { "%02x".format(it) }

    fun hasPinnedPeer(invitation: ConversationInvitation): Boolean =
        invitation.peerRoutingId.isNotEmpty() && invitation.peerIdentityReference.isNotEmpty()

    fun selectPinned(targetHash: String, invitations: List<ConversationInvitation>): ConversationInvitation? =
        invitations.firstOrNull { hasPinnedPeer(it) && hash(it.conversationId) == targetHash }
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
    private val callRelayAdmissionMutex = Mutex()
    private val relayReconnectTracker = RelayPresenceReconnectTracker()
    private val sessions = NativeSessionRegistry(crypto, stateStore)
    private val contactVerification = ContactVerification(stateStore)
    @Volatile private var conversation: ConversationInvitation? = null
    private var observer: ((AndroidChatMessage) -> Unit)? = null
    private var peerIdentityObserver: ((String, String) -> Unit)? = null
    @Volatile private var callSignalObserver: ((String) -> Unit)? = null

    suspend fun profileDisplayName(): String = stateStore.read("profile", "display-name")?.let { bytes ->
        try { bytes.decodeToString() } finally { bytes.fill(0) }
    }?.takeIf(String::isNotBlank) ?: "You"

    suspend fun saveProfileDisplayName(value: String): String {
        val trimmed = value.trim()
        require(trimmed.isNotEmpty() && trimmed.length <= 40 && trimmed.none { it.isISOControl() }) { "Display name is invalid" }
        val name = trimmed.replace(Regex("\\s+"), " ")
        stateStore.write("profile", "display-name", name.encodeToByteArray())
        return name
    }

    suspend fun saveContactNickname(conversationHash: String, value: String): String {
        require(conversationHash.matches(Regex("^[0-9a-f]{64}$"))) { "Saved contact is unavailable" }
        val trimmed = value.trim()
        require(trimmed.isNotEmpty() && trimmed.length <= 80 && trimmed.none { it.isISOControl() }) { "Contact name is invalid" }
        val name = trimmed.replace(Regex("\\s+"), " ")
        stateStore.write("contact-nickname", conversationHash, name.encodeToByteArray())
        return name
    }

    init {
        scope.launch {
            relay.connected.collect { connected ->
                if (!connected) {
                    if (BuildConfig.DEBUG) DebugInspectionStore.setConnectionStage("relay_socket_disconnected")
                    relayReconnectTracker.onConnectionChanged(false)
                    return@collect
                }
                if (!relayReconnectTracker.onConnectionChanged(true)) {
                    if (BuildConfig.DEBUG) DebugInspectionStore.setConnectionStage("relay_socket_connected")
                    return@collect
                }
                val binding = conversation?.takeIf(SavedConversationIndex::hasPinnedPeer) ?: return@collect
                if (BuildConfig.DEBUG) DebugInspectionStore.setConnectionStage("relay_rejoin_started")
                runCatching {
                    ensureCallRelayJoined(binding)
                    sendPendingJoinIntroduction(binding)
                }
                    .onSuccess { if (BuildConfig.DEBUG) DebugInspectionStore.setConnectionStage("relay_rejoined") }
                    .onFailure { if (BuildConfig.DEBUG) DebugInspectionStore.setConnectionStage("relay_rejoin_failed") }
            }
        }
        relay.onCallSignal { signal ->
            if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("relay-call-signal-arrived")
            scope.launch { receiveCallSignal(signal) }
        }
        relay.onDelivery { delivery, acknowledge ->
            scope.launch {
                if (BuildConfig.DEBUG) DebugInspectionStore.setDeliveryStage("mailbox-received")
                val binding = conversation
                if (binding == null || binding.conversationId != delivery.conversationId) {
                    if (BuildConfig.DEBUG) DebugInspectionStore.setInboundMessageResultCategory("conversation-mismatch")
                    acknowledge(false)
                    return@launch
                }
                val accepted = receive(binding, delivery)
                acknowledge(accepted)
                if (BuildConfig.DEBUG && accepted) DebugInspectionStore.setDeliveryStage("acknowledgement")
            }
        }
    }

    fun observeCallSignals(observer: (String) -> Unit) { callSignalObserver = observer }
    suspend fun activeConversation(): ConversationInvitation = mutex.withLock {
        val binding = conversation?.takeIf(SavedConversationIndex::hasPinnedPeer) ?: error("A verified conversation is required for calls")
        require(contactVerification.state(binding) == ContactVerificationState.VERIFIED) { "A verified conversation is required for calls" }
        binding
    }

    internal suspend fun activeContactVerification(): ContactVerificationState = mutex.withLock {
        conversation?.let { contactVerification.state(it) } ?: ContactVerificationState.CONTACT_CREATED
    }

    suspend fun verifyActiveContact(confirmedFingerprint: String) = mutex.withLock {
        val binding = conversation ?: error("Contact is unavailable")
        contactVerification.markVerified(binding, confirmedFingerprint)
    }

    /** Explicitly arms one replacement pre-key message after out-of-band comparison with the pinned peer. */
    suspend fun armVerifiedSessionRenewal(confirmedPeerFingerprint: String) = mutex.withLock {
        val binding = conversation?.takeIf(SavedConversationIndex::hasPinnedPeer) ?: error("A verified conversation is required")
        require(contactVerification.state(binding) == ContactVerificationState.VERIFIED) { "A verified conversation is required" }
        require(confirmedPeerFingerprint == binding.peerIdentityReference) { "Peer identity confirmation did not match" }
        require(sessions.existing(binding.peerRoutingId) != null) { "There is no established session to renew" }
        VodozemacBundleCodec.parse(api.fetchPrekeys(binding.conversationId, binding.controlCapability, binding.peerRoutingId), confirmedPeerFingerprint)
        stateStore.armSessionRenewal(binding.peerRoutingId, System.currentTimeMillis() + 10 * 60_000)
    }

    /** A Socket.IO reconnect loses the backend's channel registration; rejoin with a fresh existing proof. */
    private suspend fun ensureCallRelayJoined(binding: ConversationInvitation) = callRelayAdmissionMutex.withLock {
        if (!relay.connected.value) relay.connect()
        relay.awaitConnected()
        if (relay.isJoinedTo(binding.conversationId)) return@withLock
        val local = identity.activeState()
        val proof = proofs.acquire(identity.activeAccount(), local.toProofIdentity(), "relay:message", ProofResource(conversationId = binding.conversationId))
        relay.joinAndReplay(RelayJoin(binding.localRoutingId, binding.conversationId, binding.controlCapability, binding.routingProof, proof, listOf("join-introduction-v1")))
    }

    /** Reasserts the existing proof-backed channel registration when the app resumes. */
    suspend fun ensureActiveRelayRegistration() {
        val binding = conversation?.takeIf(SavedConversationIndex::hasPinnedPeer) ?: return
        ensureCallRelayJoined(binding)
    }

    suspend fun sendCallSignal(plaintext: String) {
        val binding = activeConversation()
        ensureCallRelayJoined(binding)
        try {
            sendCallSignalOnce(plaintext, binding.conversationId)
        } catch (error: Throwable) {
            if (relay.lastCallSignalResultCategory() != "sender_not_joined") throw error
            ensureCallRelayJoined(binding)
            sendCallSignalOnce(plaintext, binding.conversationId)
        }
    }

    /** Encrypts through the existing Olm/Vodozemac session, commits the mutated session, then signals through the proof-checked relay. */
    private suspend fun sendCallSignalOnce(plaintext: String, expectedConversationId: String) = mutex.withLock {
        val binding = conversation ?: error("Call conversation is unavailable")
        require(binding.conversationId == expectedConversationId) { "Call conversation changed while reconnecting" }
        require(binding.peerRoutingId.isNotEmpty() && binding.peerIdentityReference.startsWith("K3 ") &&
            contactVerification.state(binding) == ContactVerificationState.VERIFIED) { "Verified contact is required for calls" }
        require(plaintext.toByteArray(Charsets.UTF_8).size in 1..65_536) { "Call signal is malformed" }
        val local = identity.activeState()
        val account = identity.activeAccount()
        val session = sessions.existing(binding.peerRoutingId) ?: error("An established encrypted conversation session is required before calling")
        val bytes = MessageFrame.encodeSignaling(plaintext)
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
        if (binding.conversationId != signal.conversationId || binding.peerRoutingId.isEmpty() ||
            contactVerification.state(binding) != ContactVerificationState.VERIFIED) return@withLock
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
            val signalText = MessageFrame.decodeSignaling(plaintext!!)
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
            callSignalObserver?.invoke(signalText)
            if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("signal-received")
        } catch (_: Throwable) {
            if (mutated) { session?.let { runCatching { crypto.closeSession(it) } }; runCatching { invalidateAfterMutation() } }
        } finally { plaintext?.fill(0) }
    }

    /** Creates a local conversation from a validated invitation; the peer route may arrive in its signed introduction. */
    suspend fun createConversation(invitation: ConversationInvitation): ConversationInvitation {
        validateInvitation(invitation)
        if (invitation.peerRoutingId.isNotEmpty()) {
            VodozemacBundleCodec.parse(api.fetchPrekeys(invitation.conversationId, invitation.controlCapability, invitation.peerRoutingId), invitation.peerIdentityReference)
        } else require(invitation.peerIdentityReference.isEmpty())
        val existing = stateStore.read("conversation", invitation.conversationId)
        if (existing != null) {
            val restored = parseInvitation(existing.decodeToString())
            val isInvitationRouteMerge = restored.peerRoutingId.isEmpty() && invitation.peerRoutingId.isNotEmpty() &&
                restored.copy(peerRoutingId = invitation.peerRoutingId, peerIdentityReference = invitation.peerIdentityReference) == invitation
            require(restored == invitation || isInvitationRouteMerge) { "Conversation identity or routing changed" }
            if (isInvitationRouteMerge) {
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
    suspend fun connect(invitation: ConversationInvitation, onMessage: (AndroidChatMessage) -> Unit, onPeerIdentityPending: (String, String) -> Unit = { _, _ -> }) {
        var stage = "publish_prekeys"
        DebugInspectionStore.setConnectionStage(stage)
        try {
            val localPublication = identity.publishPrekeys(invitation.conversationId, invitation.controlCapability)
            require(localPublication.getString("address") == invitation.localRoutingId) { "Local routing identity does not match this device's published pre-key bundle" }
            stage = "conversation_validation"; DebugInspectionStore.setConnectionStage(stage)
            val binding = createConversation(invitation)
            mutex.withLock { conversation = binding; observer = onMessage; peerIdentityObserver = onPeerIdentityPending }
            stage = "relay_connect"; DebugInspectionStore.setConnectionStage(stage)
            if (!relay.connected.value) relay.connect()
            relay.awaitConnected()
            stage = "proof_request"; DebugInspectionStore.setConnectionStage(stage)
            stage = "relay_join"; DebugInspectionStore.setConnectionStage(stage)
            // Do not hold the crypto/session lock while replay waits for client acceptance.
            ensureCallRelayJoined(binding)
            stage = "joined"; DebugInspectionStore.setConnectionStage(stage)
            mutex.withLock { retryPending(binding) }
            sendPendingJoinIntroduction(binding)
        } catch (error: Throwable) {
            val category = when {
                error.message?.startsWith("request-rejected-") == true -> "http_rejected"
                error.message == "request-failed" -> "http_unavailable"
                else -> "failed"
            }
            val safeJoinCategory = if (BuildConfig.DEBUG && stage == "relay_join") relay.lastJoinFailureCategory() else null
            DebugInspectionStore.setConnectionStage("${stage}_${safeJoinCategory ?: category}")
            throw error
        }
    }

    /** Creates a private room invitation. A joined peer remains unverified until explicit fingerprint confirmation. */
    suspend fun createNewConversation(onMessage: (AndroidChatMessage) -> Unit, onPeerIdentityPending: (String, String) -> Unit): ConversationInvitation {
        val randomCapability = ByteArray(32).also(SecureRandom()::nextBytes)
        val capability = Base64.getUrlEncoder().withoutPadding().encodeToString(randomCapability)
        randomCapability.fill(0)
        val capabilityHash = MessageDigest.getInstance("SHA-256").digest(capability.encodeToByteArray()).joinToString("") { "%02x".format(it) }
        val conversationId = api.createChatLink(capabilityHash).getString("hash")
        val local = identity.publishPrekeys(conversationId, capability)
        val invitation = ConversationInvitation(conversationId, local.getString("address"), "", "", capability, local.getString("renewalProof"))
        connect(invitation, onMessage, onPeerIdentityPending)
        return invitation
    }

    suspend fun prepareInvitationJoin(invitation: ConversationInvitation) {
        require(invitation.peerRoutingId.isNotBlank() && invitation.peerIdentityReference.isNotBlank())
        stateStore.write("join-introduction-pending", invitation.conversationId, byteArrayOf(1))
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
    suspend fun savedConversations(): List<SavedConversationSummary> {
        val activeId = stateStore.read("conversation-active", "selected")?.let { bytes ->
            try { bytes.decodeToString() } finally { bytes.fill(0) }
        }
        val lastActivityByConversation = stateStore.messages().groupBy { it.conversationId }
            .mapValues { (_, messages) -> messages.maxOfOrNull { it.receivedAt } ?: 0L }
        return stateStore.list("conversation").mapNotNull { (_, bytes) ->
            val invitation = try { parseInvitation(bytes.decodeToString()) } finally { bytes.fill(0) }
            if (!SavedConversationIndex.hasPinnedPeer(invitation)) return@mapNotNull null
            SavedConversationSummary(
                conversationHash = SavedConversationIndex.hash(invitation.conversationId),
                label = stateStore.read("contact-nickname", SavedConversationIndex.hash(invitation.conversationId))?.let { bytes ->
                    try { bytes.decodeToString() } finally { bytes.fill(0) }
                }?.takeIf(String::isNotBlank) ?: "Contact",
                trustState = if (contactVerification.state(invitation) == ContactVerificationState.VERIFIED) "verified" else "unverified",
                connectionState = if (invitation.conversationId == activeId && relay.connected.value) "connected" else "saved",
                deliveryState = if (lastActivityByConversation[invitation.conversationId]?.let { it > 0L } == true) "has_messages" else "empty",
                lastActivityTimestamp = lastActivityByConversation[invitation.conversationId] ?: 0L,
            )
        }.sortedWith(compareByDescending<SavedConversationSummary> { it.lastActivityTimestamp }.thenBy { it.conversationHash })
    }

    /** Reopens a persisted, identity-pinned conversation; verification remains a separate local decision. */
    suspend fun selectSavedConversation(
        conversationHash: String,
        onMessage: (AndroidChatMessage) -> Unit,
        onPeerIdentityPending: (String, String) -> Unit,
    ): ConversationInvitation {
        val saved = stateStore.list("conversation").map { (_, bytes) ->
            try { parseInvitation(bytes.decodeToString()) } finally { bytes.fill(0) }
        }
        val invitation = SavedConversationIndex.selectPinned(conversationHash, saved)
            ?: error("Saved conversation is unavailable")
        connect(invitation, onMessage, onPeerIdentityPending)
        return invitation
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
        require(binding.peerRoutingId.isNotEmpty()) { "The contact route is not available yet" }
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

    /** Sends only the existing signed/encrypted join-introduction frame; it never changes local trust. */
    private suspend fun sendPendingJoinIntroduction(binding: ConversationInvitation) = mutex.withLock {
        if (binding.peerRoutingId.isBlank() || !relay.peerSupportsFeature("join-introduction-v1")) return@withLock
        val pending = stateStore.read("join-introduction-pending", binding.conversationId)
        val storedOutbox = stateStore.read("join-introduction-outbox", binding.conversationId)
        if (pending == null && storedOutbox == null) return@withLock
        var serialized = storedOutbox
        if (serialized == null) {
            val local = identity.activeState()
            val account = identity.activeAccount()
            val identityKeys = crypto.identityKeys(account)
            val eventId = UUID.randomUUID().toString()
            val unsigned = JoinIntroduction(1, eventId, binding.conversationId, binding.localRoutingId, local.deviceIdentityReference, System.currentTimeMillis(), "")
            val signature = crypto.signControlEvent(account, JoinIntroductionFrame.canonicalPayload(unsigned))
            val signatureUrl = Base64.getUrlEncoder().withoutPadding().encodeToString(Base64.getDecoder().decode(signature))
            val event = unsigned.copy(signature = signatureUrl)
            require(IdentityFingerprint.generate(identityKeys) == local.deviceIdentityReference)
            val frame = MessageFrame.encodeControl(JoinIntroductionFrame.encode(event))
            var mutated = false
            try {
                val session = sessions.existing(binding.peerRoutingId) ?: newOutboundSession(binding)
                val olm = crypto.encrypt(session, frame)
                mutated = true
                val envelope = JSONObject().put("version", 2).put("strategy", "vodozemac-olm-v1")
                    .put("data", JSONObject().put("version", 1).put("olmMessage", olm)).toString()
                val outbox = JSONObject().put("eventId", eventId).put("envelope", envelope).toString().encodeToByteArray()
                val pickleKey = pickleKeys.load(local.deviceIdentityReference)
                try {
                    val accountPickle = crypto.saveAccount(account, pickleKey)
                    val sessionPickle = crypto.saveSession(session)
                    try { stateStore.commitControlOutbound(local.deviceIdentityReference, accountPickle, SessionState(binding.peerRoutingId, sessionPickle), binding.conversationId, outbox) }
                    finally { sessionPickle.fill(0); outbox.fill(0) }
                } finally { pickleKey.fill(0) }
                sessions.remember(binding.peerRoutingId, session)
                serialized = stateStore.read("join-introduction-outbox", binding.conversationId)
            } catch (error: Throwable) {
                if (mutated && stateStore.read("join-introduction-outbox", binding.conversationId) == null) invalidateAfterMutation()
                throw error
            } finally { frame.fill(0) }
        }
        val payload = try { JSONObject(serialized!!.decodeToString()) } finally { serialized?.fill(0) }
        val local = identity.activeState()
        val proof = proofs.acquire(identity.activeAccount(), local.toProofIdentity(), "relay:message", ProofResource(conversationId = binding.conversationId))
        relay.sendEnvelopeAwait(payload.getString("envelope"), binding.peerRoutingId, proof)
        stateStore.finishControlOutbound(binding.conversationId)
        pending?.fill(0)
    }

    private suspend fun receive(binding: ConversationInvitation, item: com.k3ncrypt.network.RelayDelivery): Boolean = mutex.withLock {
        try {
            val unpinnedConversation = binding.peerRoutingId.isEmpty()
            require(!unpinnedConversation || item.sender.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")))
            val current = identity.activeState()
            val account = identity.activeAccount()
            val resolver = SenderBundleResolver { sender ->
                require(unpinnedConversation || sender == binding.peerRoutingId) { "Unknown conversation sender" }
                val remote = VodozemacBundleCodec.parse(api.fetchPrekeys(binding.conversationId, binding.controlCapability, sender), binding.peerIdentityReference.takeIf(String::isNotEmpty))
                SenderBundle(remote.identity.curve25519, remote.identity.ed25519)
            }
            val trust = DeviceTrustVerifier { sender, senderIdentity ->
                if (unpinnedConversation) {
                    require(sender == item.sender && senderIdentity.isNotBlank()) { "Introduction sender is invalid" }
                } else {
                    require(sender == binding.peerRoutingId) { "Unknown sender route" }
                    val remote = VodozemacBundleCodec.parse(api.fetchPrekeys(binding.conversationId, binding.controlCapability, sender), binding.peerIdentityReference)
                    require(remote.identity.curve25519 == senderIdentity && IdentityFingerprint.generate(remote.identity) == binding.peerIdentityReference) { "Sender identity mismatch" }
                }
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
                controlFrameHandler = AuthenticatedControlFrameHandler { delivery, payload, senderBundle ->
                    val event = JoinIntroductionFrame.parse(payload) ?: return@AuthenticatedControlFrameHandler null
                    require(unpinnedConversation) { "A pinned conversation cannot be rebound by an introduction" }
                    require(delivery.conversationId == binding.conversationId && event.conversationId == binding.conversationId && event.senderAddress == delivery.senderRoutingId)
                    val remote = VodozemacBundleCodec.parse(api.fetchPrekeys(binding.conversationId, binding.controlCapability, delivery.senderRoutingId), null)
                    require(remote.identity.curve25519 == senderBundle.senderIdentityKey && remote.identity.ed25519 == senderBundle.senderEd25519Key)
                    val fingerprint = IdentityFingerprint.generate(remote.identity)
                    require(event.identityCommitment == fingerprint)
                    require(crypto.verifyIdentitySignature(remote.identity.ed25519, JoinIntroductionFrame.canonicalPayload(event), event.signature))
                    val existingBytes = stateStore.read("conversation", binding.conversationId) ?: error("Invitation conversation is missing")
                    val restored = parseInvitation(existingBytes.decodeToString())
                    require(restored == binding && restored.peerRoutingId.isEmpty() && restored.peerIdentityReference.isEmpty()) { "Conversation was already associated with another identity" }
                    val discovered = restored.copy(peerRoutingId = delivery.senderRoutingId, peerIdentityReference = fingerprint)
                    InboundControlAcceptance(
                        writes = listOf(SecureStateWrite("conversation", binding.conversationId, invitationJson(discovered).toString().encodeToByteArray(), existingBytes)),
                        replayNamespace = "join-introduction-seen",
                        replayRecordId = binding.conversationId,
                        replayValue = event.eventId.encodeToByteArray(),
                    )
                },
                requireControlFrame = unpinnedConversation,
                diagnosticStage = { stage -> if (BuildConfig.DEBUG) DebugInspectionStore.setDeliveryStage(stage) },
            )
            when (val result = processor.receive(MailboxDelivery(item.id, item.sender, item.envelope, item.conversationId))) {
                DeliveryAcceptance.Accepted -> {
                    if (BuildConfig.DEBUG) DebugInspectionStore.setInboundMessageResultCategory("accepted")
                    if (unpinnedConversation) {
                        val bytes = stateStore.read("conversation", binding.conversationId) ?: error("Accepted contact metadata is missing")
                        val discovered = try { parseInvitation(bytes.decodeToString()) } finally { bytes.fill(0) }
                        conversation = discovered
                        peerIdentityObserver?.invoke(discovered.peerRoutingId, discovered.peerIdentityReference)
                    }
                    stateStore.messages().lastOrNull { it.deliveryId == item.id }?.let { observer?.invoke(AndroidChatMessage(it.deliveryId, it.conversationId, it.senderRoutingId, it.text, it.receivedAt)) }
                    true
                }
                DeliveryAcceptance.Duplicate -> { if (BuildConfig.DEBUG) DebugInspectionStore.setInboundMessageResultCategory("duplicate"); true }
                is DeliveryAcceptance.Rejected -> { if (BuildConfig.DEBUG) DebugInspectionStore.setInboundMessageResultCategory(result.category); false }
            }
        } catch (_: Exception) { if (BuildConfig.DEBUG) DebugInspectionStore.setInboundMessageResultCategory("receive-failed"); false }
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
