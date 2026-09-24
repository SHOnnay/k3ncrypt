package com.k3ncrypt.app

import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import dagger.hilt.android.AndroidEntryPoint
import com.k3ncrypt.network.K3ncryptApi
import com.k3ncrypt.network.NetworkEndpoint
import com.k3ncrypt.network.SocketRelay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.security.MessageDigest
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var identities: AndroidIdentityLifecycleRepository
    @Inject lateinit var messaging: AndroidMessagingRepository
    @Inject lateinit var api: K3ncryptApi
    @Inject lateinit var relay: SocketRelay

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    IdentityAndConversationScreen(this, identities, messaging, api, relay)
                }
            }
        }
    }
}

/** Prevents a delivery callback racing the persisted-message snapshot from duplicating LazyColumn keys. */
internal fun appendUniqueChatMessage(target: MutableList<AndroidChatMessage>, message: AndroidChatMessage): Boolean {
    if (target.any { it.id == message.id }) return false
    target.add(message)
    return true
}

internal fun appendUniqueChatMessages(target: MutableList<AndroidChatMessage>, incoming: Iterable<AndroidChatMessage>) {
    val knownIds = target.mapTo(mutableSetOf()) { it.id }
    incoming.forEach { message -> if (knownIds.add(message.id)) target.add(message) }
}

private data class ModernInvitation(val conversationId: String, val controlCapability: String, val peerRoutingId: String, val peerFingerprint: String)

private fun parseModernInvitation(raw: String): ModernInvitation {
    require(raw.isNotBlank() && raw.length <= 4096) { "Paste a valid K3NCRYPT invitation." }
    val fragment = if (raw.contains('#')) raw.substringAfter('#') else raw.removePrefix("#")
    val uri = Uri.parse("https://invitation.invalid/?$fragment")
    val keys = uri.queryParameterNames
    require(keys == setOf("modern", "control", "address", "identity")) { "Invitation fields are incomplete or unexpected." }
    require(keys.all { uri.getQueryParameters(it).size == 1 }) { "Invitation contains duplicate fields." }
    val conversationId = uri.getQueryParameter("modern") ?: error("Invitation is incomplete")
    val control = uri.getQueryParameter("control") ?: error("Invitation is incomplete")
    val address = uri.getQueryParameter("address") ?: error("Invitation is incomplete")
    val fingerprint = uri.getQueryParameter("identity") ?: error("Invitation is incomplete")
    val uuidPattern = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")
    require(uuidPattern.matches(conversationId) && uuidPattern.matches(address)) { "Invitation address is malformed." }
    require(Regex("[A-Za-z0-9_-]{43}").matches(control)) { "Invitation capability is malformed." }
    require(Regex("K3 [A-Z0-9_ -]{20,128}").matches(fingerprint)) { "Invitation fingerprint is malformed." }
    return ModernInvitation(conversationId, control, address, fingerprint)
}

@androidx.compose.runtime.Composable
private fun IdentityAndConversationScreen(
    context: Context,
    identities: AndroidIdentityLifecycleRepository,
    messaging: AndroidMessagingRepository,
    api: K3ncryptApi,
    relay: SocketRelay,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val preferences = remember { context.getSharedPreferences("k3ncrypt-runtime", Context.MODE_PRIVATE) }
    var state by remember { mutableStateOf<AndroidIdentityState?>(null) }
    var target by remember { mutableStateOf<NewDeviceEnrollmentIdentity?>(null) }
    var targetDeviceId by remember { mutableStateOf("") }
    var targetIdentityReference by remember { mutableStateOf("") }
    var targetVerificationKey by remember { mutableStateOf("") }
    var targetFingerprint by remember { mutableStateOf("") }
    var approvedAccountReference by remember { mutableStateOf("") }
    var approvedPendingEpoch by remember { mutableStateOf("") }
    var endpoint by remember { mutableStateOf(preferences.getString("backend", BuildConfig.K3NCRYPT_BACKEND_URL).orEmpty()) }
    var socketEndpoint by remember { mutableStateOf(preferences.getString("socket", BuildConfig.K3NCRYPT_SOCKET_URL).orEmpty()) }
    var invitationInput by remember { mutableStateOf("") }
    var fingerprintConfirmation by remember { mutableStateOf("") }
    var conversation by remember { mutableStateOf<ConversationInvitation?>(null) }
    var savedTrustedConversations by remember { mutableStateOf<List<SavedConversationSummary>>(emptyList()) }
    var outgoingInvite by remember { mutableStateOf("") }
    var pendingPeer by remember { mutableStateOf<Pair<String, String>?>(null) }
    var draft by remember { mutableStateOf("") }
    val chatMessages = remember { mutableStateListOf<AndroidChatMessage>() }
    var messageStatus by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("Configure the backend, then create or join a private conversation.") }
    var busy by remember { mutableStateOf(false) }

    // Debug inspection is strictly observational. It does not participate in
    // conversation setup, first-contact confirmation, encryption, or relay ACKs.
    LaunchedEffect(conversation?.conversationId, conversation?.peerIdentityReference, conversation?.peerRoutingId, pendingPeer?.second, status, messageStatus, chatMessages.size) {
        DebugInspectionStore.update(
            conversationId = conversation?.conversationId,
            trustState = when {
                pendingPeer != null -> "pending-confirmation"
                conversation?.let(SavedConversationIndex::isTrusted) == true -> "verified"
                conversation != null -> "unverified"
                else -> "none"
            },
            connectionState = status,
            deliveryState = messageStatus.ifBlank { "idle" },
            lastActivityTimestamp = chatMessages.maxOfOrNull { it.timestamp } ?: 0L,
        )
        savedTrustedConversations = runCatching { messaging.savedTrustedConversations() }.getOrDefault(emptyList())
    }

    fun onMessage(message: AndroidChatMessage) {
        scope.launch {
            if (conversation?.conversationId != message.conversationId) return@launch
            if (!appendUniqueChatMessage(chatMessages, message)) {
                messageStatus = "Duplicate encrypted delivery ignored."
                return@launch
            }
            messageStatus = if (message.senderRoutingId == conversation?.localRoutingId) {
                "Sent; relay acknowledgement received."
            } else {
                "Received, persisted, and accepted by the relay."
            }
        }
    }
    fun onPeerPending(route: String, fingerprint: String) {
        scope.launch {
            pendingPeer = route to fingerprint
            status = "A new peer is waiting for identity confirmation. Do not accept unless this fingerprint matches through a trusted channel."
        }
    }

    LaunchedEffect(Unit) {
        // Debug validation may open the ordinary invitation form without
        // auto-selecting a previously saved conversation. It never changes
        // trust state and leaves fingerprint confirmation to the user.
        val seededInvitation = DebugJoinSeed.consume(context)
        seededInvitation?.let { invitationInput = it }
        if (endpoint.isNotBlank()) {
            runCatching {
                val backend = NetworkEndpoint.validate(endpoint)
                val socketUrl = NetworkEndpoint.validate(socketEndpoint.ifBlank { backend })
                api.configureBaseUrl(backend)
                relay.configureUrl(socketUrl)
                socketEndpoint = socketUrl
            }.onFailure { status = it.message ?: "Backend endpoint configuration is invalid." }
        }
        runCatching { identities.restore() }.onSuccess { restored ->
            state = restored
            status = "Saved identity restored. Protected actions still require current server authorization."
            if (restored.lifecycleState == "active" && endpoint.isNotBlank() && seededInvitation == null) {
                messaging.restoreConversation()?.let { saved ->
                    runCatching {
                        conversation = saved
                        messaging.connect(saved, saved.peerIdentityReference.ifBlank { null }, ::onMessage, ::onPeerPending)
                        appendUniqueChatMessages(chatMessages, messaging.messages().filter { it.conversationId == saved.conversationId })
                    }.onSuccess { status = "Conversation restored and authenticated relay join completed." }
                        .onFailure { error -> status = if (BuildConfig.DEBUG && relay.lastJoinFailureCategory() != null) "Relay join rejected: ${relay.lastJoinFailureCategory()}" else "Conversation reconnect failed closed: ${error.message?.take(110) ?: error.javaClass.simpleName}" }
                }
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("K3NCRYPT", style = MaterialTheme.typography.headlineMedium)
        Text("Android identity and encrypted messaging", style = MaterialTheme.typography.titleMedium)
        Text(status)

        Text("Backend connection", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(endpoint, { endpoint = it }, label = { Text("Backend HTTPS origin (emulator: http://10.0.2.2:3001)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(socketEndpoint, { socketEndpoint = it }, label = { Text("Socket.IO origin (blank uses backend)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(enabled = !busy && endpoint.isNotBlank(), onClick = {
            scope.launch {
                busy = true
                runCatching {
                    val backend = NetworkEndpoint.validate(endpoint)
                    val socketUrl = NetworkEndpoint.validate(socketEndpoint.ifBlank { backend })
                    api.configureBaseUrl(backend)
                    relay.configureUrl(socketUrl)
                    preferences.edit().putString("backend", backend).putString("socket", socketUrl).apply()
                    socketEndpoint = socketUrl
                    status = "Backend endpoint configured."
                }.onFailure { status = it.message ?: "Backend endpoint configuration failed." }
                busy = false
            }
        }) { Text("Save backend endpoint") }

        state?.let { identity ->
            Text("Device: ${identity.deviceId}")
            Text("Identity fingerprint: ${identity.deviceIdentityReference}")
            Text("Lifecycle: ${identity.lifecycleState} · epoch ${identity.trustEpoch}")
            if (identity.lifecycleState == "bootstrap-pending") {
                Button(enabled = !busy && endpoint.isNotBlank(), onClick = {
                    scope.launch {
                        busy = true
                        runCatching { identities.retryPendingBootstrap() }
                            .onSuccess { state = it; status = "Initial device bootstrap was accepted." }
                            .onFailure { status = "Bootstrap was rejected or remains unavailable. The original signed request is retained." }
                        busy = false
                    }
                }) { Text("Retry first-device bootstrap") }
            }
            if (identity.lifecycleState == "active") {
                Button(enabled = !busy && endpoint.isNotBlank(), onClick = {
                    scope.launch {
                        busy = true
                        runCatching {
                            val created = messaging.createNewConversation(::onMessage, ::onPeerPending)
                            conversation = created
                            outgoingInvite = "#modern=${Uri.encode(created.conversationId)}&control=${Uri.encode(created.controlCapability)}&address=${Uri.encode(created.localRoutingId)}&identity=${Uri.encode(identity.deviceIdentityReference)}"
                            chatMessages.clear()
                            status = "Private conversation created. Share the invitation securely; first peer messages remain held until you confirm their identity fingerprint."
                        }.onFailure { error -> status = "Conversation could not be created: ${error.message?.take(140) ?: error.javaClass.simpleName}" }
                        busy = false
                    }
                }) { Text("Create private conversation") }

                if (savedTrustedConversations.isNotEmpty()) {
                    Text("Saved trusted conversations", style = MaterialTheme.typography.titleMedium)
                    savedTrustedConversations.forEach { saved ->
                        Button(enabled = !busy, onClick = {
                            scope.launch {
                                busy = true
                                runCatching {
                                    val selected = messaging.selectSavedTrustedConversation(saved.conversationHash, ::onMessage, ::onPeerPending)
                                    conversation = selected
                                    pendingPeer = null
                                    outgoingInvite = ""
                                    chatMessages.clear()
                                    appendUniqueChatMessages(chatMessages, messaging.messages().filter { it.conversationId == selected.conversationId })
                                    status = "Verified conversation selected and authenticated."
                                }.onFailure { status = "Saved trusted conversation could not be restored." }
                                busy = false
                            }
                        }) {
                            Text("Open verified · ${saved.conversationHash.take(12)} · ${saved.lastActivityTimestamp}")
                        }
                    }
                }

                OutlinedTextField(invitationInput, { invitationInput = it }, label = { Text("Paste a K3NCRYPT modern invitation") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(fingerprintConfirmation, { fingerprintConfirmation = it }, label = { Text("Confirm invited peer fingerprint") }, modifier = Modifier.fillMaxWidth())
                Button(enabled = !busy && endpoint.isNotBlank(), onClick = {
                    scope.launch {
                        busy = true
                        runCatching {
                            val parsed = parseModernInvitation(invitationInput)
                            require(fingerprintConfirmation.trim() == parsed.peerFingerprint) { "Peer fingerprint confirmation did not match the invitation." }
                            val local = identities.publishPrekeys(parsed.conversationId, parsed.controlCapability)
                            val joined = ConversationInvitation(parsed.conversationId, local.getString("address"), parsed.peerRoutingId, parsed.peerFingerprint, parsed.controlCapability, local.getString("renewalProof"))
                            messaging.connect(joined, fingerprintConfirmation.trim(), ::onMessage, ::onPeerPending)
                            conversation = joined
                            chatMessages.clear()
                            appendUniqueChatMessages(chatMessages, messaging.messages().filter { it.conversationId == joined.conversationId })
                            status = "Conversation joined. The relay carries only encrypted envelopes."
                        }.onFailure { error -> status = if (BuildConfig.DEBUG && relay.lastJoinFailureCategory() != null) "Relay join rejected: ${relay.lastJoinFailureCategory()}" else error.message?.takeIf { message -> message.length < 180 } ?: "Invitation could not be joined. Verify it and check connectivity." }
                        busy = false
                    }
                }) { Text("Join conversation") }
            }
        } ?: run {
            Button(enabled = !busy && endpoint.isNotBlank(), onClick = {
                scope.launch {
                    busy = true
                    runCatching { identities.createFirstDevice() }
                        .onSuccess { state = it; status = "First device registered with the durable backend trust authority." }
                        .onFailure { status = "Bootstrap was not accepted. Local signed state is retained; configure a reachable backend and retry."; state = runCatching { identities.restore() }.getOrNull() }
                    busy = false
                }
            }) { Text("Create first device") }
            Button(enabled = !busy, onClick = {
                scope.launch {
                    busy = true
                    runCatching { target = identities.createEnrollmentTarget(); identities.restore() }
                        .onSuccess { state = it; status = "Independent device identity created; it still needs trusted-device approval and activation." }
                        .onFailure { status = "Enrollment identity could not be prepared." }
                    busy = false
                }
            }) { Text("Prepare device enrollment") }
        }

        target?.let { newDevice ->
            Text("Target device: ${newDevice.deviceId}")
            Text("Target fingerprint: ${newDevice.fingerprint}")
            Text("Public verification key: ${newDevice.verificationKey}")
        }

        state?.takeIf { it.lifecycleState == "active" }?.let { identity ->
            Text("Approve another device")
            OutlinedTextField(targetDeviceId, { targetDeviceId = it }, label = { Text("Target device ID") }, singleLine = true)
            OutlinedTextField(targetIdentityReference, { targetIdentityReference = it }, label = { Text("Target identity fingerprint") }, singleLine = true)
            OutlinedTextField(targetVerificationKey, { targetVerificationKey = it }, label = { Text("Target Ed25519 public key") }, singleLine = true)
            OutlinedTextField(targetFingerprint, { targetFingerprint = it }, label = { Text("Confirm target fingerprint") }, singleLine = true)
            Button(enabled = !busy && targetDeviceId.isNotBlank() && endpoint.isNotBlank(), onClick = {
                scope.launch {
                    busy = true
                    runCatching { identities.approveDevice(NewDeviceEnrollmentIdentity(targetDeviceId.trim(), targetIdentityReference.trim(), targetVerificationKey.trim(), targetFingerprint.trim())) }
                        .onSuccess { result -> approvedAccountReference = result.getString("accountIdentityReference"); approvedPendingEpoch = result.getLong("trustEpoch").toString(); status = "Target was durably enrolled as pending approval." }
                        .onFailure { status = "Enrollment was rejected by the device trust authority." }
                    busy = false
                }
            }) { Text("Approve and enroll device") }
            if (approvedAccountReference.isNotBlank()) Text("Target activation data: $approvedAccountReference · epoch $approvedPendingEpoch")
            if (identity.lifecycleState == "target-awaiting-approval") {
                Text("Enter the account reference and pending epoch provided by the approving device.")
                OutlinedTextField(approvedAccountReference, { approvedAccountReference = it }, label = { Text("Account reference") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(approvedPendingEpoch, { approvedPendingEpoch = it }, label = { Text("Pending epoch") }, modifier = Modifier.fillMaxWidth())
                Button(enabled = !busy && approvedAccountReference.isNotBlank() && approvedPendingEpoch.toLongOrNull() != null && endpoint.isNotBlank(), onClick = {
                    scope.launch {
                        busy = true
                        runCatching { identities.activateApprovedDevice(approvedAccountReference.trim(), approvedPendingEpoch.toLong()) }
                            .onSuccess { state = it; status = "Signed device activation accepted." }
                            .onFailure { status = "Activation was rejected by the backend trust authority." }
                        busy = false
                    }
                }) { Text("Confirm and activate device") }
            }
        }

        conversation?.let { active ->
            Spacer(Modifier.height(8.dp))
            Text("Conversation: ${active.conversationId}", style = MaterialTheme.typography.titleMedium)
            if (outgoingInvite.isNotBlank()) {
                Text("Share this invitation fragment with a trusted contact:")
                Text(outgoingInvite)
                Button(onClick = { clipboard.setText(AnnotatedString(outgoingInvite)); status = "Invitation copied." }) { Text("Copy invitation") }
            }
            pendingPeer?.let { (route, fingerprint) ->
                Text("Unverified peer route: $route")
                Text("Peer identity fingerprint: $fingerprint")
                OutlinedTextField(fingerprintConfirmation, { fingerprintConfirmation = it }, label = { Text("Type the fingerprint after verifying it out of band") }, modifier = Modifier.fillMaxWidth())
                Button(enabled = !busy && fingerprintConfirmation.trim() == fingerprint, onClick = {
                    scope.launch {
                        busy = true
                        runCatching { messaging.confirmFirstContact(route, fingerprintConfirmation.trim(), ::onMessage, ::onPeerPending) }
                            .onSuccess { conversation = active.copy(peerRoutingId = route, peerIdentityReference = fingerprint); pendingPeer = null; status = "Peer identity pinned. Retained encrypted messages are now eligible for validation." }
                            .onFailure { status = "Peer confirmation failed; the encrypted mailbox item remains unaccepted." }
                        busy = false
                    }
                }) { Text("Confirm and pin peer") }
            }
            LazyColumn(modifier = Modifier.fillMaxWidth().height(240.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(chatMessages.filter { it.conversationId == active.conversationId }, key = { it.id }) { message ->
                    Column {
                        Text(message.text)
                        Text(if (message.senderRoutingId == active.localRoutingId) "Sent · relay accepted" else "Received · persisted before acceptance", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            OutlinedTextField(draft, { draft = it }, label = { Text("Message") }, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = !busy && draft.isNotBlank() && active.peerRoutingId.isNotBlank(), onClick = {
                    val text = draft
                    scope.launch {
                        busy = true
                        messageStatus = "Encrypting and sending…"
                        runCatching { messaging.sendText(text) }
                            .onSuccess { draft = ""; messageStatus = "Sent; relay acknowledgement received." }
                            .onFailure { messageStatus = "Send failed. The encrypted outbox is retained for retry after reconnect." }
                        busy = false
                    }
                }) { Text("Send") }
                Button(enabled = !busy && endpoint.isNotBlank(), onClick = {
                    scope.launch {
                        busy = true
                        runCatching { messaging.connect(active, active.peerIdentityReference.ifBlank { null }, ::onMessage, ::onPeerPending) }
                            .onSuccess { messageStatus = "Reconnected; encrypted mailbox replay requested." }
                            .onFailure { messageStatus = "Reconnect failed; stored messages and outbox are retained." }
                        busy = false
                    }
                }) { Text("Reconnect") }
            }
            Text(messageStatus)
        }
    }
}
