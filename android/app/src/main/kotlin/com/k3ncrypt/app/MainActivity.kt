package com.k3ncrypt.app

import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.background
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import kotlinx.coroutines.delay
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Add
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.compose.runtime.DisposableEffect
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import dagger.hilt.android.AndroidEntryPoint
import com.k3ncrypt.network.K3ncryptApi
import com.k3ncrypt.network.NetworkEndpoint
import com.k3ncrypt.network.SocketRelay
import com.k3ncrypt.calls.CallPermissionFeedback
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
    @Inject lateinit var calls: AndroidCallController

    override fun onResume() {
        super.onResume()
        if (this::calls.isInitialized) calls.recordApplicationLifecycle(backgrounded = false)
        lifecycleScope.launch {
            runCatching { messaging.ensureActiveRelayRegistration() }
                .onFailure { if (BuildConfig.DEBUG) DebugInspectionStore.setConnectionStage("resume_rejoin_failed") }
        }
    }

    override fun onPause() {
        if (this::calls.isInitialized) calls.recordApplicationLifecycle(backgrounded = true)
        super.onPause()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val appearance = remember { getSharedPreferences("k3ncrypt-runtime", Context.MODE_PRIVATE) }
            var themeMode by remember { mutableStateOf(appearance.getString("theme-mode", "system") ?: "system") }
            val dark = when (themeMode) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
            SideEffect {
                WindowCompat.getInsetsController(window, window.decorView).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }
            K3ncryptTheme(darkTheme = dark) {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    IdentityAndConversationScreen(this, identities, messaging, api, relay, calls, themeMode) { mode ->
                        themeMode = mode
                        appearance.edit().putString("theme-mode", mode).apply()
                    }
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
private fun CallVideoSurface(track: VideoTrack, calls: AndroidCallController, mirror: Boolean, height: Int) {
    var renderer by remember(track) { mutableStateOf<SurfaceViewRenderer?>(null) }
    AndroidView(modifier = Modifier.fillMaxWidth().height(height.dp), factory = { viewContext ->
        SurfaceViewRenderer(viewContext).apply {
            init(calls.eglContext(), null)
            setEnableHardwareScaler(true)
            setMirror(mirror)
            track.addSink(this)
            renderer = this
        }
    }, update = { view ->
        if (renderer !== view) {
            renderer?.let { track.removeSink(it); it.release() }
            view.init(calls.eglContext(), null)
            view.setEnableHardwareScaler(true)
            view.setMirror(mirror)
            track.addSink(view)
            renderer = view
        }
    })
    DisposableEffect(track) {
        onDispose { renderer?.let { track.removeSink(it); it.release(); renderer = null } }
    }
}

@androidx.compose.runtime.Composable
private fun IdentityAndConversationScreen(
    context: Context,
    identities: AndroidIdentityLifecycleRepository,
    messaging: AndroidMessagingRepository,
    api: K3ncryptApi,
    relay: SocketRelay,
    calls: AndroidCallController,
    themeMode: String,
    onThemeModeChange: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
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
    var showPeerComparison by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf("") }
    val chatMessages = remember { mutableStateListOf<AndroidChatMessage>() }
    var messageStatus by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("Configure the backend, then create or join a private conversation.") }
    var busy by remember { mutableStateOf(false) }
    var showAdvancedVerification by remember { mutableStateOf(false) }
    var showNewConversation by remember { mutableStateOf(false) }
    var identityChecked by remember { mutableStateOf(false) }
    var selectedTab by remember { mutableStateOf("chats") }
    val callState by calls.state.collectAsState()
    var callElapsedSeconds by remember(callState.callId) { mutableStateOf(0) }
    var pendingCallAction by remember { mutableStateOf<String?>(null) }
    val callPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val action = pendingCallAction
        pendingCallAction = null
        val needsCamera = action == "video" || action == "accept-video"
        val denial = CallPermissionFeedback.denial(if (needsCamera) "video" else "audio", granted[android.Manifest.permission.RECORD_AUDIO] == true, granted[android.Manifest.permission.CAMERA] == true)
        if (denial == null) {
            scope.launch {
                runCatching {
                    when (action) {
                        "audio" -> calls.startVoice()
                        "video" -> calls.startVideo()
                        "accept-audio", "accept-video" -> calls.accept()
                    }
                }.onFailure { status = "Call could not start. Check permissions and connection, then retry." }
            }
        } else status = denial
    }
    fun requestCallPermissions(action: String) {
        pendingCallAction = action
        val permissions = mutableListOf(android.Manifest.permission.RECORD_AUDIO)
        if (action == "video" || action == "accept-video") permissions += android.Manifest.permission.CAMERA
        callPermissionLauncher.launch(permissions.toTypedArray())
    }

    LaunchedEffect(callState.callId, callState.incoming) {
        if (BuildConfig.DEBUG && callState.callId != null && callState.incoming) {
            DebugInspectionStore.setCallSignalStage("incoming-ui-triggered")
        }
    }

    LaunchedEffect(callState.callId, callState.status) {
        if (callState.callId != null && callState.status == "connected") {
            callElapsedSeconds = 0
            while (true) {
                delay(1_000)
                callElapsedSeconds += 1
            }
        } else {
            callElapsedSeconds = 0
        }
    }

    LaunchedEffect(conversation?.conversationId, conversation?.peerIdentityReference, conversation?.peerRoutingId, pendingPeer?.second, status, messageStatus, chatMessages.size) {
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
            showPeerComparison = false
            status = "A new peer is waiting for identity confirmation. Do not accept unless this fingerprint matches through a trusted channel."
        }
    }

    LaunchedEffect(Unit) {
        // Remove invitations left by older debug builds. They contained
        // bearer capabilities and are no longer accepted through a test hook.
        context.getSharedPreferences("debug-join-seed", Context.MODE_PRIVATE).edit().clear().apply()
        if (endpoint.isNotBlank()) {
            runCatching {
                val backend = NetworkEndpoint.validate(endpoint, allowEmulatorHttp = BuildConfig.DEBUG)
                val socketUrl = NetworkEndpoint.validate(socketEndpoint.ifBlank { backend }, allowEmulatorHttp = BuildConfig.DEBUG)
                api.configureBaseUrl(backend, allowEmulatorHttp = BuildConfig.DEBUG)
                relay.configureUrl(socketUrl, allowEmulatorHttp = BuildConfig.DEBUG)
                socketEndpoint = socketUrl
            }.onFailure { status = "Backend endpoint configuration is invalid. Use a valid HTTPS service address." }
        }
        runCatching { identities.restore() }.onSuccess { restored ->
            state = restored
            identityChecked = true
            if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("identity-restored")
            status = "Saved identity restored. Protected actions still require current server authorization."
            if (restored.lifecycleState == "active" && endpoint.isNotBlank()) {
                messaging.restoreConversation()?.let { saved ->
                    runCatching {
                        conversation = saved
                        messaging.connect(saved, saved.peerIdentityReference.ifBlank { null }, ::onMessage, ::onPeerPending)
                        appendUniqueChatMessages(chatMessages, messaging.messages().filter { it.conversationId == saved.conversationId })
                    }.onSuccess {
                        if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("conversation-restored")
                        status = "Conversation restored and authenticated relay join completed."
                    }
                        .onFailure { status = "Conversation reconnect failed closed. Check the connection and retry." }
                }
            }
        }.onFailure {
            identityChecked = true
            status = "Your saved device could not be restored. Check this device and try again."
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
      Column(modifier = Modifier.fillMaxSize().statusBarsPadding().animateContentSize()) {
       K3ncryptTopBar(
           title = when (selectedTab) { "contacts" -> "Contacts"; "calls" -> "Calls"; "settings" -> "Settings"; else -> "K3NCRYPT" },
           subtitle = when (selectedTab) {
               "contacts" -> "Trusted conversations on this device"
               "calls" -> "Private voice and video calls"
               "settings" -> "Your device and privacy preferences"
               else -> if (conversation != null && SavedConversationIndex.isTrusted(conversation!!)) "Trusted contact · secure connection" else "Private communication you control"
           },
           action = if (selectedTab == "chats") ({
               Row {
                   if (conversation != null && !showNewConversation) {
                       IconButton(onClick = { showNewConversation = true }) {
                           Icon(Icons.Filled.Add, contentDescription = "New conversation", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                       }
                   }
                   IconButton(onClick = { selectedTab = "settings" }) {
                       Icon(Icons.Filled.Settings, contentDescription = "Open settings", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                   }
               }
           }) else null,
       )
       if (busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
       if (!identityChecked) {
        Column(Modifier.weight(1f).fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            K3ncryptCard {
                Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    K3ncryptBrandMark()
                    Text("Opening your private space", style = MaterialTheme.typography.titleLarge)
                    Text("Restoring this device securely…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    CircularProgressIndicator(modifier = Modifier.padding(top = 4.dp).size(24.dp), strokeWidth = 2.dp)
                }
            }
        }
       } else if (selectedTab == "chats") {
        val focusedChat = conversation != null && !showNewConversation
        Column(
          modifier = if (focusedChat) Modifier.weight(1f).padding(horizontal = 16.dp, vertical = 8.dp)
                     else Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),
          verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
        if (!focusedChat) {
            K3ncryptSectionTitle("Private messaging", if (showNewConversation) "New conversation" else "Chats", "Your conversations stay protected on this device.")
            if (showNewConversation && conversation != null) {
                OutlinedButton(onClick = { showNewConversation = false }) { Text("Back to conversation") }
            }
            if (status.isNotBlank()) K3ncryptNotice(status, k3ncryptNoticeToneFor(status))
        }

        if (!showNewConversation) conversation?.let { active ->
            pendingPeer?.let { (route, fingerprint) ->
                Text("New contact request")
                Text("Compare this peer’s identity with a trusted channel before pinning. Messages remain unaccepted until verification.")
                Button(enabled = !busy, onClick = { showPeerComparison = !showPeerComparison }) {
                    Text(if (showPeerComparison) "Hide fingerprint comparison" else "Compare fingerprint")
                }
                if (showPeerComparison) {
                    Text("Peer identity fingerprint: $fingerprint")
                    OutlinedTextField(fingerprintConfirmation, { fingerprintConfirmation = it }, label = { Text("Type the fingerprint after verifying it out of band") }, modifier = Modifier.fillMaxWidth())
                    Button(enabled = !busy && fingerprintConfirmation.trim() == fingerprint, onClick = {
                        scope.launch {
                            busy = true
                            runCatching { messaging.confirmFirstContact(route, fingerprintConfirmation.trim(), ::onMessage, ::onPeerPending) }
                                .onSuccess {
                                    conversation = active.copy(peerRoutingId = route, peerIdentityReference = fingerprint)
                                    pendingPeer = null
                                    showPeerComparison = false
                                    fingerprintConfirmation = ""
                                    status = "Secure connection established."
                                }
                                .onFailure { status = "Peer confirmation failed; the encrypted mailbox item remains unaccepted." }
                            busy = false
                        }
                    }) { Text("Confirm and pin peer") }
                }
            }
        }

        if (!focusedChat && (state == null || showAdvancedVerification)) K3ncryptCard {
          Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Connection setup", style = MaterialTheme.typography.titleMedium)
        Text("Choose the service endpoint for this device. Use HTTPS for hosted deployments.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(endpoint, { endpoint = it }, label = { Text("Backend service address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(socketEndpoint, { socketEndpoint = it }, label = { Text("Realtime service address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(enabled = !busy && endpoint.isNotBlank(), onClick = {
            scope.launch {
                busy = true
                runCatching {
                    val backend = NetworkEndpoint.validate(endpoint, allowEmulatorHttp = BuildConfig.DEBUG)
                    val socketUrl = NetworkEndpoint.validate(socketEndpoint.ifBlank { backend }, allowEmulatorHttp = BuildConfig.DEBUG)
                    api.configureBaseUrl(backend, allowEmulatorHttp = BuildConfig.DEBUG)
                    relay.configureUrl(socketUrl, allowEmulatorHttp = BuildConfig.DEBUG)
                    preferences.edit().putString("backend", backend).putString("socket", socketUrl).apply()
                    socketEndpoint = socketUrl
                    status = "Backend endpoint configured."
                }.onFailure { status = "Backend endpoint configuration failed. Use a valid HTTPS service address." }
                busy = false
            }
        }) { Text("Save connection") }
          }
        }

        if (!focusedChat) state?.let { identity ->
            Text(if (identity.lifecycleState == "active") "Verified device" else "Device setup: ${identity.lifecycleState}")
            if (showAdvancedVerification) {
                Text("Device identity fingerprint: ${identity.deviceIdentityReference}")
                Text("Device reference: ${identity.deviceId} · trust epoch ${identity.trustEpoch}")
            }
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
                            showNewConversation = false
                            outgoingInvite = "#modern=${Uri.encode(created.conversationId)}&control=${Uri.encode(created.controlCapability)}&address=${Uri.encode(created.localRoutingId)}&identity=${Uri.encode(identity.deviceIdentityReference)}"
                            chatMessages.clear()
                            status = "Private conversation created. Share the invitation securely; first peer messages remain held until you confirm their identity fingerprint."
                        }.onFailure { status = "Conversation could not be created. Check the connection and retry." }
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
                                    showPeerComparison = false
                                    outgoingInvite = ""
                                    chatMessages.clear()
                                    appendUniqueChatMessages(chatMessages, messaging.messages().filter { it.conversationId == selected.conversationId })
                                    if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("conversation-restored")
                            status = "Secure connection established."
                                }.onFailure { status = "Saved trusted conversation could not be restored." }
                                busy = false
                            }
                        }) {
                            Text("Open trusted conversation")
                        }
                    }
                }

                OutlinedTextField(invitationInput, { invitationInput = it }, label = { Text("Paste a K3NCRYPT modern invitation") }, modifier = Modifier.fillMaxWidth())
                if (showAdvancedVerification) {
                    OutlinedTextField(fingerprintConfirmation, { fingerprintConfirmation = it }, label = { Text("Confirm invited peer fingerprint") }, modifier = Modifier.fillMaxWidth())
                }
                Button(enabled = !busy && endpoint.isNotBlank() && showAdvancedVerification, onClick = {
                    scope.launch {
                        busy = true
                        runCatching {
                            val parsed = parseModernInvitation(invitationInput)
                            require(fingerprintConfirmation.trim() == parsed.peerFingerprint) { "Peer fingerprint confirmation did not match the invitation." }
                            val local = identities.publishPrekeys(parsed.conversationId, parsed.controlCapability)
                            val joined = ConversationInvitation(parsed.conversationId, local.getString("address"), parsed.peerRoutingId, parsed.peerFingerprint, parsed.controlCapability, local.getString("renewalProof"))
                            messaging.connect(joined, fingerprintConfirmation.trim(), ::onMessage, ::onPeerPending)
                            conversation = joined
                            showNewConversation = false
                            chatMessages.clear()
                            appendUniqueChatMessages(chatMessages, messaging.messages().filter { it.conversationId == joined.conversationId })
                            status = "Secure connection established."
                        }.onFailure { status = "Invitation could not be joined. Verify it and check connectivity." }
                        busy = false
                    }
                }) { Text("Join conversation") }
                if (!showAdvancedVerification) Text("Identity comparison is available in Settings → Security → Advanced verification.")
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

        if (!focusedChat) target?.let { newDevice ->
            Text("A separate device identity is ready for trusted approval.")
            if (showAdvancedVerification) {
                Text("Target device: ${newDevice.deviceId}")
                Text("Target fingerprint: ${newDevice.fingerprint}")
                Text("Public verification key: ${newDevice.verificationKey}")
            }
        }

        if (!focusedChat) state?.takeIf { it.lifecycleState == "active" && showAdvancedVerification }?.let { identity ->
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

        if (!showNewConversation) conversation?.let { active ->
            if (focusedChat) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(if (SavedConversationIndex.isTrusted(active)) "Trusted contact" else "New contact", style = MaterialTheme.typography.titleMedium)
                        Text(if (SavedConversationIndex.isTrusted(active)) "Secure connection established" else "Identity confirmation required", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    K3ncryptStatus(if (SavedConversationIndex.isTrusted(active)) "Verified" else "Review", positive = SavedConversationIndex.isTrusted(active))
                }
            } else {
                Spacer(Modifier.height(8.dp))
                Text(if (SavedConversationIndex.isTrusted(active)) "Trusted contact" else "New contact", style = MaterialTheme.typography.titleMedium)
            }
            if (outgoingInvite.isNotBlank()) {
                Text("Share this invitation securely with a trusted contact.")
                Button(onClick = { clipboard.setText(AnnotatedString(outgoingInvite)); status = "Invitation copied." }) { Text("Copy invitation") }
            }
            LazyColumn(
                modifier = Modifier.fillMaxWidth().then(if (focusedChat) Modifier.weight(1f) else Modifier.height(320.dp)).padding(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val visibleMessages = chatMessages.filter { it.conversationId == active.conversationId }
                if (visibleMessages.isEmpty()) {
                    item {
                        K3ncryptEmptyState("Your conversation starts here", "Messages are protected and saved on this device.")
                    }
                } else items(visibleMessages, key = { it.id }) { message ->
                    val sentByThisDevice = message.senderRoutingId == active.localRoutingId
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = if (sentByThisDevice) Arrangement.End else Arrangement.Start,
                    ) {
                        Surface(
                            modifier = Modifier.fillMaxWidth(0.84f),
                            shape = MaterialTheme.shapes.large,
                            color = if (sentByThisDevice) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                            tonalElevation = if (sentByThisDevice) 0.dp else 1.dp,
                        ) {
                            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(message.text, color = if (sentByThisDevice) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    if (sentByThisDevice) "Sent · delivered" else "Received securely",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (sentByThisDevice) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.78f) else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
            OutlinedTextField(draft, { draft = it }, label = { Text("Message") }, modifier = Modifier.fillMaxWidth(), maxLines = 4)
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
            if (messageStatus.isNotBlank()) K3ncryptNotice(messageStatus, k3ncryptNoticeToneFor(messageStatus))
            if (SavedConversationIndex.isTrusted(active)) {
                if (showAdvancedVerification) {
                    Text("If your contact lost only their encrypted conversation session, compare their fingerprint through another trusted channel before approving one replacement pre-key message. Your saved conversation and prior session remain encrypted on this device.")
                    Text("Trusted contact fingerprint: ${active.peerIdentityReference}")
                    OutlinedTextField(fingerprintConfirmation, { fingerprintConfirmation = it }, label = { Text("Confirm trusted contact fingerprint") }, modifier = Modifier.fillMaxWidth(),
                        singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { keyboardController?.hide() }))
                    Button(enabled = !busy && fingerprintConfirmation.trim() == active.peerIdentityReference, onClick = {
                        scope.launch {
                            busy = true
                            runCatching { messaging.armVerifiedSessionRenewal(fingerprintConfirmation.trim()) }
                                .onSuccess { fingerprintConfirmation = ""; status = "Verified session renewal prepared for ten minutes. Waiting for one authenticated pre-key message." }
                                .onFailure { status = "Session renewal approval failed; no session state was changed." }
                            busy = false
                        }
                    }) { Text("Prepare verified session renewal") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = callState.callId == null, onClick = { requestCallPermissions("audio") }) { Text("Voice call") }
                    Button(enabled = callState.callId == null, onClick = { requestCallPermissions("video") }) { Text("Video call") }
                }
            }
        }
        }
       } else if (selectedTab == "contacts") {
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            K3ncryptSectionTitle("Your people", "Contacts", "Trusted conversations saved on this device.")
            if (savedTrustedConversations.isEmpty()) {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                    K3ncryptEmptyState("Your contacts will appear here", "Create or join a private conversation to connect with someone you trust.")
                }
            } else savedTrustedConversations.forEach { saved ->
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, tonalElevation = 1.dp) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Trusted contact", style = MaterialTheme.typography.titleMedium)
                        Text("Saved privately on this device", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Button(enabled = !busy, onClick = {
                            scope.launch {
                                busy = true
                                runCatching {
                                    val selected = messaging.selectSavedTrustedConversation(saved.conversationHash, ::onMessage, ::onPeerPending)
                                    conversation = selected
                                    pendingPeer = null
                                    showPeerComparison = false
                                    outgoingInvite = ""
                                    chatMessages.clear()
                                    appendUniqueChatMessages(chatMessages, messaging.messages().filter { it.conversationId == selected.conversationId })
                                    status = "Secure connection established."
                                    selectedTab = "chats"
                                }.onFailure { status = "Saved trusted conversation could not be restored." }
                                busy = false
                            }
                        }) { Text("Open conversation") }
                    }
                }
            }
        }
       } else if (selectedTab == "calls") {
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            K3ncryptSectionTitle("Stay in touch", "Calls", "Start a call from a trusted, connected conversation.")
            val active = conversation
            if (active == null) {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                    K3ncryptEmptyState("No active conversation", "Open a saved contact before calling. Call authorization remains bound to that conversation.")
                }
            } else {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                    Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Trusted contact", style = MaterialTheme.typography.titleMedium)
                        Text(if (SavedConversationIndex.isTrusted(active) && callState.callId == null) "Secure connection established" else "Finish contact verification before calling.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(enabled = !busy && callState.callId == null && SavedConversationIndex.isTrusted(active), onClick = { requestCallPermissions("audio") }) { Text("Voice call") }
                            Button(enabled = !busy && callState.callId == null && SavedConversationIndex.isTrusted(active), onClick = { requestCallPermissions("video") }) { Text("Video call") }
                        }
                        if (callState.callId != null) Text("${callState.mediaMode.replaceFirstChar { it.uppercase() }} call · ${callState.status}")
                    }
                }
            }
        }
       } else {
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            K3ncryptSectionTitle("Your device", "Settings", "Choose how K3NCRYPT looks and review this device’s security.")
            K3ncryptCard {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Appearance", style = MaterialTheme.typography.titleMedium)
                    Text("This preference stays on this device.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("system" to "System", "light" to "Light", "dark" to "Dark").forEach { (mode, label) ->
                            if (themeMode == mode) Button(onClick = { onThemeModeChange(mode) }) { Text(label) }
                            else OutlinedButton(onClick = { onThemeModeChange(mode) }) { Text(label) }
                        }
                    }
                }
            }
            K3ncryptCard {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Connection", style = MaterialTheme.typography.titleMedium)
                    Text("Configure the service this device connects to. Hosted services should use HTTPS.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(endpoint, { endpoint = it }, label = { Text("Backend HTTPS origin") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(socketEndpoint, { socketEndpoint = it }, label = { Text("Socket.IO origin") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Button(enabled = !busy && endpoint.isNotBlank(), onClick = {
                        scope.launch {
                            busy = true
                            runCatching {
                                val backend = NetworkEndpoint.validate(endpoint, allowEmulatorHttp = BuildConfig.DEBUG)
                                val socketUrl = NetworkEndpoint.validate(socketEndpoint.ifBlank { backend }, allowEmulatorHttp = BuildConfig.DEBUG)
                                api.configureBaseUrl(backend, allowEmulatorHttp = BuildConfig.DEBUG)
                                relay.configureUrl(socketUrl, allowEmulatorHttp = BuildConfig.DEBUG)
                                preferences.edit().putString("backend", backend).putString("socket", socketUrl).apply()
                                socketEndpoint = socketUrl
                                status = "Backend endpoint configured."
                            }.onFailure { status = "Backend endpoint configuration failed. Use a valid HTTPS service address." }
                            busy = false
                        }
                    }) { Text("Save connection") }
                }
            }
            K3ncryptCard {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Security", style = MaterialTheme.typography.titleMedium)
                    K3ncryptStatus(if (state?.lifecycleState == "active") "Verified device" else "Device setup required", positive = state?.lifecycleState == "active")
                    Text("Identity comparison and device lifecycle controls stay explicit. Fingerprints are available only in advanced verification.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(onClick = { showAdvancedVerification = !showAdvancedVerification }) { Text(if (showAdvancedVerification) "Close advanced verification" else "Advanced verification") }
                    if (showAdvancedVerification) state?.let { identity ->
                        Text("Device identity fingerprint", style = MaterialTheme.typography.labelLarge)
                        Text(identity.deviceIdentityReference, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            K3ncryptCard {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("Privacy", style = MaterialTheme.typography.titleMedium)
                    Text("Messages are shown from this device’s saved conversation data. No analytics controls are needed here.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Text("Message previews stay inside the app. Passphrases and private keys are not shown in settings.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
       }
       NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
        listOf("chats" to "Chats", "contacts" to "Contacts", "calls" to "Calls", "settings" to "Settings").forEach { (route, label) ->
            NavigationBarItem(
                selected = selectedTab == route,
                onClick = { selectedTab = route },
                icon = { Icon(imageVector = when (route) { "chats" -> Icons.Filled.ChatBubbleOutline; "contacts" -> Icons.Filled.Contacts; "calls" -> Icons.Filled.Call; else -> Icons.Filled.Settings }, contentDescription = null) },
                label = { Text(label) },
                alwaysShowLabel = true,
                colors = NavigationBarItemDefaults.colors(selectedIconColor = MaterialTheme.colorScheme.primary, selectedTextColor = MaterialTheme.colorScheme.primary, indicatorColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
            )
        }
       }
      }
      AnimatedVisibility(
          visible = callState.callId != null,
          enter = fadeIn() + scaleIn(initialScale = 0.97f),
          exit = fadeOut() + scaleOut(targetScale = 0.98f),
      ) {
          val callLabel = when (callState.status.lowercase()) {
              "ringing" -> if (callState.incoming) "Incoming call" else "Calling…"
              "connecting" -> "Connecting securely…"
              "connected", "completed" -> "Secure call connected"
              "reconnecting" -> "Reconnecting…"
              "failed", "timeout" -> "The call could not connect."
              else -> "Call in progress"
          }
          Box(
              modifier = Modifier.fillMaxSize().background(Color(0xB80E1216)).padding(16.dp),
              contentAlignment = Alignment.Center,
          ) {
              Surface(
                  modifier = Modifier.fillMaxWidth(),
                  shape = MaterialTheme.shapes.extraLarge,
                  color = MaterialTheme.colorScheme.surface,
                  tonalElevation = 4.dp,
                  shadowElevation = 18.dp,
              ) {
                  Column(
                      modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
                      horizontalAlignment = Alignment.CenterHorizontally,
                      verticalArrangement = Arrangement.spacedBy(14.dp),
                  ) {
                      K3ncryptBrandMark()
                      Text(if (callState.incoming) "Incoming ${callState.mediaMode} call" else "${callState.mediaMode.replaceFirstChar { it.uppercase() }} call", style = MaterialTheme.typography.titleLarge)
                      Text("Trusted contact", color = MaterialTheme.colorScheme.onSurfaceVariant)
                      K3ncryptStatus(callLabel, positive = callState.status in setOf("connected", "completed"))
                      if (callState.status == "connected") {
                          Text("${callElapsedSeconds / 60}:${(callElapsedSeconds % 60).toString().padStart(2, '0')}", style = MaterialTheme.typography.titleMedium)
                      }
                      if (callState.status == "failed" || callState.errorCategory != null) {
                          Text("Check your connection and try again.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                      }
                      if (callState.mediaMode == "video" && !callState.incoming) {
                          callState.remoteVideo?.let { CallVideoSurface(it, calls, mirror = false, height = 210) }
                          callState.localVideo?.let { CallVideoSurface(it, calls, mirror = true, height = 100) }
                      }
                      if (callState.incoming) {
                          Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                              Button(onClick = {
                                  if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("accept-action")
                                  requestCallPermissions(if (callState.mediaMode == "video") "accept-video" else "accept-audio")
                              }) { Text("Accept") }
                              OutlinedButton(onClick = {
                                  if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("decline-action")
                                  scope.launch { runCatching { calls.reject() }.onFailure { status = "Call could not be declined." } }
                              }) { Text("Decline") }
                          }
                      } else {
                          Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                              OutlinedButton(onClick = { calls.setMicrophoneEnabled(!callState.microphoneEnabled) }) {
                                  Text(if (callState.microphoneEnabled) "Mute" else "Unmute")
                              }
                              if (callState.mediaMode == "video") {
                                  OutlinedButton(onClick = { calls.setCameraEnabled(!callState.cameraEnabled) }) {
                                      Text(if (callState.cameraEnabled) "Camera off" else "Camera on")
                                  }
                                  OutlinedButton(onClick = calls::switchCamera) { Text("Switch") }
                              }
                              Button(
                                  colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                                  onClick = { scope.launch { runCatching { calls.hangup() }.onFailure { status = "Call could not end." } } },
                              ) { Text("End call") }
                          }
                      }
                  }
              }
          }
      }
    }
}
