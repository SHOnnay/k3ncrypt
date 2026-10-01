package com.k3ncrypt.app

import android.content.Context
import android.content.Intent
import android.app.Activity
import android.app.KeyguardManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.view.WindowManager
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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Image
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
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Mic
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.compose.runtime.DisposableEffect
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
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
import com.k3ncrypt.crypto.IdentityFingerprint
import com.k3ncrypt.calls.CallPermissionFeedback
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import javax.inject.Inject
import com.k3ncrypt.storage.LocalVaultGate
import com.k3ncrypt.storage.KeystoreAead
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var identities: AndroidIdentityLifecycleRepository
    @Inject lateinit var messaging: AndroidMessagingRepository
    @Inject lateinit var api: K3ncryptApi
    @Inject lateinit var relay: SocketRelay
    @Inject lateinit var calls: AndroidCallController
    @Inject lateinit var vaultGate: LocalVaultGate
    @Inject lateinit var storageCipher: KeystoreAead
    private var vaultReady by mutableStateOf(false)
    private var unlockMessage by mutableStateOf("Use your device PIN, password, or biometrics to unlock the encrypted vault on this device. Your secure identity remains on this device.")
    private var backgroundSince: Long? = null
    private var lockCleanupInProgress by mutableStateOf(false)
    private val credentialPrompt = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) finishLocalUnlock()
        else unlockMessage = "Device authentication was cancelled. Your local data remains locked."
    }

    private fun finishLocalUnlock() {
        lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { vaultGate.openAfterSystemAuthentication() } }
                .onSuccess { vaultReady = true; unlockMessage = "" }
                .onFailure { unlockMessage = "Could not unlock local storage. Your existing data was preserved; authenticate again or check the device lock." }
        }
    }

    private fun requestLocalUnlock() {
        if (lockCleanupInProgress) return
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (!keyguard.isDeviceSecure) {
            unlockMessage = "Set a device PIN, password, or pattern in Android settings before using K3NCRYPT."
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val prompt = BiometricPrompt.Builder(this)
                .setTitle("Unlock K3NCRYPT")
                .setSubtitle("Use biometrics or your device credential")
                .setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG or
                    android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build()
            prompt.authenticate(CancellationSignal(), mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { finishLocalUnlock() }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    unlockMessage = "Device authentication did not complete. Your local data remains locked."
                }
            })
        } else {
            @Suppress("DEPRECATION")
            val intent = keyguard.createConfirmDeviceCredentialIntent("Unlock K3NCRYPT", "Confirm your device credential")
            if (intent != null) credentialPrompt.launch(intent)
            else unlockMessage = "Device credential authentication is unavailable. Your local data remains locked."
        }
    }

    override fun onStart() {
        super.onStart()
        val awaySince = backgroundSince
        backgroundSince = null
        if (awaySince != null && vaultReady && SystemClock.elapsedRealtime() - awaySince >= 60_000L &&
            (!this::calls.isInitialized || calls.state.value.callId == null)) {
            vaultReady = false
            storageCipher.lock()
            unlockMessage = "Use your device PIN, password, or biometrics to unlock the encrypted vault on this device."
            lockCleanupInProgress = true
            lifecycleScope.launch {
                try {
                    runCatching { messaging.disconnect() }
                    runCatching { identities.invalidateVolatileIdentity() }
                } finally { lockCleanupInProgress = false }
            }
        }
    }

    override fun onStop() {
        if (vaultReady) backgroundSince = SystemClock.elapsedRealtime()
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        if (this::calls.isInitialized) calls.recordApplicationLifecycle(backgrounded = false)
        if (!vaultReady) return
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
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
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
                    if (vaultReady) {
                        IdentityAndConversationScreen(this, identities, messaging, api, relay, calls, themeMode) { mode ->
                            themeMode = mode
                            appearance.edit().putString("theme-mode", mode).apply()
                        }
                    } else {
                        Column(Modifier.fillMaxSize().padding(28.dp), verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            K3ncryptBrandMark()
                            Spacer(Modifier.height(20.dp))
                            Text("Unlock your private space", style = MaterialTheme.typography.headlineMedium)
                            Spacer(Modifier.height(12.dp))
                            Text(unlockMessage, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(20.dp))
                            Button(onClick = ::requestLocalUnlock, enabled = !lockCleanupInProgress) { Text("Unlock with device") }
                            if (!getSystemService(KeyguardManager::class.java).isDeviceSecure) {
                                OutlinedButton(onClick = { startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS)) }) {
                                    Text("Open device security settings")
                                }
                            }
                        }
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

private fun formatChatTime(timestamp: Long): String = runCatching {
    DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(timestamp))
}.getOrDefault("")

private fun sharePrivateInvitation(context: Context, invitation: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, invitation)
    }
    context.startActivity(Intent.createChooser(send, "Share private invitation"))
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
    var profileName by remember { mutableStateOf("You") }
    var profileNameDraft by remember { mutableStateOf("You") }
    var nicknameEditingHash by remember { mutableStateOf<String?>(null) }
    var nicknameDraft by remember { mutableStateOf("") }
    var targetDeviceId by remember { mutableStateOf("") }
    var targetIdentityReference by remember { mutableStateOf("") }
    var targetVerificationKey by remember { mutableStateOf("") }
    var targetFingerprint by remember { mutableStateOf("") }
    var approvedAccountReference by remember { mutableStateOf("") }
    var approvedPendingEpoch by remember { mutableStateOf("") }
    var endpoint by remember { mutableStateOf(preferences.getString("backend", BuildConfig.K3NCRYPT_BACKEND_URL).orEmpty()) }
    var socketEndpoint by remember { mutableStateOf(preferences.getString("socket", BuildConfig.K3NCRYPT_SOCKET_URL).orEmpty()) }
    var invitationInput by remember { mutableStateOf("") }
    var showNewConversation by remember { mutableStateOf(false) }
    var showConversationList by remember { mutableStateOf(true) }
    var selectedTab by remember { mutableStateOf("chats") }
    var fingerprintConfirmation by remember { mutableStateOf("") }
    var conversation by remember { mutableStateOf<ConversationInvitation?>(null) }
    var contactVerificationState by remember { mutableStateOf(ContactVerificationState.CONTACT_CREATED) }
    var verifiedBinding by remember { mutableStateOf<ConversationInvitation?>(null) }
    val activeVerified = contactVerificationState == ContactVerificationState.VERIFIED && verifiedBinding == conversation
    var savedConversations by remember { mutableStateOf<List<SavedConversationSummary>>(emptyList()) }
    val allStoredMessages = remember { mutableStateListOf<AndroidChatMessage>() }
    var outgoingInvite by remember { mutableStateOf("") }
    var draft by remember { mutableStateOf("") }
    val chatMessages = remember { mutableStateListOf<AndroidChatMessage>() }
    var messageStatus by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("Set up this device to start a private conversation.") }
    val invitationScanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        val scanned = result.contents ?: return@rememberLauncherForActivityResult
        if (runCatching { parseModernInvitation(scanned) }.isSuccess) {
            invitationInput = scanned
            selectedTab = "add-contact"
            showNewConversation = true
            status = "Invitation scanned. Joining adds an unverified contact; you can verify them afterward."
        } else {
            status = "This QR code is not a valid K3NCRYPT invitation."
        }
    }
    fun scanInvitation() {
        invitationScanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Scan a K3NCRYPT invitation").setBeepEnabled(false))
    }
    var busy by remember { mutableStateOf(false) }
    var showAdvancedVerification by remember { mutableStateOf(false) }
    var showAdvancedDeviceDetails by remember { mutableStateOf(false) }
    var showAdvancedNetwork by remember { mutableStateOf(false) }
    var identityChecked by remember { mutableStateOf(false) }
    val callState by calls.state.collectAsState()
    val relayConnected by relay.connected.collectAsState()
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

    LaunchedEffect(conversation?.conversationId, conversation?.peerIdentityReference, conversation?.peerRoutingId, status, messageStatus, chatMessages.size) {
        val bindingAtRead = conversation
        val verificationAtRead = runCatching { messaging.activeContactVerification() }.getOrDefault(ContactVerificationState.CONTACT_CREATED)
        if (conversation == bindingAtRead) {
            contactVerificationState = verificationAtRead
            verifiedBinding = if (verificationAtRead == ContactVerificationState.VERIFIED) bindingAtRead else null
        }
        savedConversations = runCatching { messaging.savedConversations() }.getOrDefault(emptyList())
        allStoredMessages.clear()
        allStoredMessages.addAll(runCatching { messaging.messages() }.getOrDefault(emptyList()))
    }

    fun onMessage(message: AndroidChatMessage) {
        scope.launch {
            if (conversation?.conversationId != message.conversationId) return@launch
            if (!appendUniqueChatMessage(chatMessages, message)) {
                messageStatus = "This message was already received."
                return@launch
            }
            messageStatus = if (message.senderRoutingId == conversation?.localRoutingId) {
                "Message delivered."
            } else {
                "New message received."
            }
        }
    }
    fun onPeerPending(route: String, fingerprint: String) {
        scope.launch {
            val active = conversation
            if (active != null && active.peerRoutingId.isEmpty()) {
                conversation = active.copy(peerRoutingId = route, peerIdentityReference = fingerprint)
                contactVerificationState = ContactVerificationState.CONTACT_CREATED
                verifiedBinding = null
                status = "Contact added. Verify their identity before trusting them."
            }
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
            profileName = runCatching { messaging.profileDisplayName() }.getOrDefault("You")
            profileNameDraft = profileName
            identityChecked = true
            if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("identity-restored")
            status = "Your saved identity is ready."
            if (restored.lifecycleState == "active" && endpoint.isNotBlank()) {
                messaging.restoreConversation()?.let { saved ->
                    runCatching {
                        conversation = saved
                        showConversationList = true
                        messaging.connect(saved, ::onMessage, ::onPeerPending)
                        appendUniqueChatMessages(chatMessages, messaging.messages().filter { it.conversationId == saved.conversationId })
                    }.onSuccess {
                        if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("conversation-restored")
                        status = "Your conversation is ready."
                    }
                        .onFailure { status = "Could not reconnect to your conversation. Your saved messages remain on this device." }
                }
            }
        }.onFailure {
            identityChecked = true
            status = "Your saved device could not be restored. Check this device and try again."
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
      Column(modifier = Modifier.fillMaxSize().statusBarsPadding().animateContentSize(animationSpec = tween(K3ncryptMotion.normal))) {
       K3ncryptTopBar(
           title = when (selectedTab) { "contacts" -> "Contacts"; "add-contact" -> "Add contact"; "calls" -> "Calls"; "settings" -> "Settings"; else -> if (state == null) "Welcome" else "K3NCRYPT" },
           subtitle = when (selectedTab) {
               "contacts" -> "People you’ve connected with"
               "add-contact" -> "Share or scan a private invitation"
               "calls" -> "Voice and video calls"
               "settings" -> "Your profile and security settings"
               else -> if (state == null) "Set up your private device" else if (conversation != null && activeVerified) "Verified contact" else "Private communication you control"
           },
           action = if (selectedTab == "chats" || selectedTab == "contacts") ({
               Row {
                   IconButton(onClick = { selectedTab = "add-contact"; showNewConversation = true }) {
                       Icon(Icons.Filled.Add, contentDescription = "Add contact", tint = MaterialTheme.colorScheme.onSurfaceVariant)
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
       } else if (selectedTab == "chats" || selectedTab == "add-contact") {
        val focusedChat = conversation != null && !showNewConversation && !showConversationList
        Column(
          modifier = if (focusedChat) Modifier.weight(1f).padding(horizontal = 16.dp, vertical = 8.dp)
                     else Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),
          verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
        if (!focusedChat) {
            K3ncryptSectionTitle(
                if (state == null) "Welcome to K3NCRYPT" else if (showNewConversation) "Add someone" else "Private messaging",
                if (state == null) "A private space for your people" else if (showNewConversation) "Start a conversation" else "Chats",
                if (state == null) "Create a secure identity on this device, then connect with someone you trust." else if (showNewConversation) "Share a private invitation or enter one from someone you trust." else "Your conversations stay protected on this device."
            )
            if (state == null) {
                OutlinedButton(onClick = { showAdvancedNetwork = !showAdvancedNetwork }) {
                    Text(if (showAdvancedNetwork) "Hide connection settings" else "Advanced connection settings")
                }
            }
            if (selectedTab == "add-contact") {
                OutlinedButton(onClick = { selectedTab = "contacts"; showNewConversation = false }) { Text("Back to contacts") }
            } else if (showNewConversation && conversation != null) {
                OutlinedButton(onClick = { showNewConversation = false; showConversationList = true }) { Text("Back to chats") }
            }
            if (status.isNotBlank()) K3ncryptNotice(status, k3ncryptNoticeToneFor(status))
            if (state == null) {
                K3ncryptCard {
                    Column(
                        Modifier.fillMaxWidth().padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        K3ncryptBrandMark()
                        Text("Your device is your identity", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "This device has its own secure identity. An invitation starts contact setup, but does not make someone trusted. Compare fingerprints through a separate trusted channel and confirm before trusting a contact. Names and nicknames are only for recognition.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
        }

        if (!focusedChat && ((state == null && showAdvancedNetwork) || (state != null && showAdvancedVerification))) K3ncryptCard {
          Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Connect to your K3NCRYPT service", style = MaterialTheme.typography.titleMedium)
        Text("If your beta invitation included a service address, enter it here. Hosted services should use HTTPS.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(endpoint, { endpoint = it }, label = { Text("Service address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(socketEndpoint, { socketEndpoint = it }, label = { Text("Realtime address (if different)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
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
            Text(when (identity.lifecycleState) {
                "active" -> "This device is ready"
                "bootstrap-pending" -> "Device setup needs a retry"
                "target-awaiting-approval" -> "Waiting for device approval"
                else -> "Device setup in progress"
            })
            if (showAdvancedVerification) {
                Text("Device identity fingerprint: ${identity.deviceIdentityReference}")
            }
            if (identity.lifecycleState == "bootstrap-pending") {
                Button(enabled = !busy && endpoint.isNotBlank(), onClick = {
                    scope.launch {
                        busy = true
                        runCatching { identities.retryPendingBootstrap() }
                            .onSuccess { state = it; status = "Your device is ready." }
                            .onFailure { status = "We couldn’t connect yet. Your device setup is safe. Check the service address and try again." }
                        busy = false
                    }
            }) { Text("Retry device setup") }
            }
            if (identity.lifecycleState == "active") {
              if (showNewConversation) {
                Button(enabled = !busy && endpoint.isNotBlank(), onClick = {
                    scope.launch {
                        busy = true
                        runCatching {
                            val created = messaging.createNewConversation(::onMessage, ::onPeerPending)
                            conversation = created
                            showConversationList = false
                            showNewConversation = false
                            selectedTab = "chats"
                            outgoingInvite = "#modern=${Uri.encode(created.conversationId)}&control=${Uri.encode(created.controlCapability)}&address=${Uri.encode(created.localRoutingId)}&identity=${Uri.encode(identity.deviceIdentityReference)}"
                            chatMessages.clear()
                            status = "Invitation ready. Share it privately; your contact will be unverified until you verify their identity."
                        }.onFailure { status = "Conversation could not be created. Check the connection and retry." }
                        busy = false
                    }
                }) { Text("Create invitation") }
              }

              if (!showNewConversation) {
                if (savedConversations.isNotEmpty()) {
                    Text("Your saved conversations", style = MaterialTheme.typography.titleMedium)
                    savedConversations.forEach { saved ->
                        val preview = allStoredMessages.asSequence()
                            .filter { SavedConversationIndex.hash(it.conversationId) == saved.conversationHash }
                            .maxByOrNull { it.timestamp }
                        Surface(
                            modifier = Modifier.fillMaxWidth().animateContentSize(animationSpec = tween(K3ncryptMotion.normal)).clickable(enabled = !busy) {
                                scope.launch {
                                    busy = true
                                    runCatching {
                                        val selected = messaging.selectSavedConversation(saved.conversationHash, ::onMessage, ::onPeerPending)
                                        conversation = selected
                                        outgoingInvite = ""
                                        showConversationList = false
                                        chatMessages.clear()
                                        val stored = messaging.messages()
                                        appendUniqueChatMessages(chatMessages, stored.filter { it.conversationId == selected.conversationId })
                                        allStoredMessages.clear()
                                        allStoredMessages.addAll(stored)
                                        if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("conversation-restored")
                                        status = "Conversation connected."
                                    }.onFailure { status = "Saved conversation could not be restored." }
                                    busy = false
                                }
                            },
                            shape = MaterialTheme.shapes.large,
                            color = MaterialTheme.colorScheme.surface,
                            tonalElevation = 1.dp,
                        ) {
                            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp)) {
                                Box(Modifier.size(46.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = .12f), RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
                                    Image(painter = painterResource(R.drawable.k3ncrypt_cluster_white), contentDescription = null, modifier = Modifier.size(27.dp), contentScale = ContentScale.Fit)
                                }
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(k3ncryptContactName(saved.label), modifier = Modifier.fillMaxWidth(), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                                    Text(preview?.text?.take(64) ?: "Start a private conversation", maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                    Text(if (preview != null) formatChatTime(preview.timestamp) else if (saved.connectionState == "connected") "Ready to chat" else "Saved on this device", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                                }
                                K3ncryptStatus(if (saved.trustState == "verified") "Verified" else "Verify contact", positive = saved.trustState == "verified")
                            }
                        }
                    }
                } else if (state?.lifecycleState == "active" && !showNewConversation) {
                    K3ncryptEmptyState("No conversations yet", "Create or join an invitation to connect. Compare fingerprints before marking a contact as trusted.")
                }
              }

              if (showNewConversation) {
                OutlinedTextField(
                    invitationInput,
                    { invitationInput = it },
                    label = { Text("Private invitation") },
                    supportingText = { Text("An invitation starts contact setup; it does not verify who sent it. Compare fingerprints and confirm before trusting the contact.") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    maxLines = 4,
                )
                OutlinedButton(enabled = !busy, onClick = ::scanInvitation) { Text("Scan invitation QR") }
                val parsedInvitation = runCatching { parseModernInvitation(invitationInput.trim()) }.getOrNull()
                if (parsedInvitation != null) K3ncryptNotice("Joining creates an unverified contact. You can compare fingerprints and verify the contact afterward.", K3ncryptNoticeTone.Attention)
                Button(enabled = !busy && endpoint.isNotBlank() && parsedInvitation != null, onClick = {
                    scope.launch {
                        busy = true
                        runCatching {
                            val parsed = parseModernInvitation(invitationInput)
                            val local = identities.publishPrekeys(parsed.conversationId, parsed.controlCapability)
                            val joined = ConversationInvitation(parsed.conversationId, local.getString("address"), parsed.peerRoutingId, parsed.peerFingerprint, parsed.controlCapability, local.getString("renewalProof"))
                            messaging.prepareInvitationJoin(joined)
                            messaging.connect(joined, ::onMessage, ::onPeerPending)
                            conversation = joined
                            showConversationList = false
                            showNewConversation = false
                            selectedTab = "chats"
                            chatMessages.clear()
                            appendUniqueChatMessages(chatMessages, messaging.messages().filter { it.conversationId == joined.conversationId })
                            status = "Conversation ready."
                        }.onFailure { status = "Invitation could not be joined. Verify it and check connectivity." }
                        busy = false
                    }
                }) { Text("Join invitation") }
              }
            }
        } ?: run {
            Button(enabled = !busy && endpoint.isNotBlank(), onClick = {
                scope.launch {
                    busy = true
                    runCatching { identities.createFirstDevice() }
                        .onSuccess { state = it; status = "Your device is ready." }
                        .onFailure { status = "We couldn’t connect yet. Your device setup is safe. Check the service address and try again."; state = runCatching { identities.restore() }.getOrNull() }
                    busy = false
                }
            }) { Text("Create my secure identity") }
            Button(enabled = !busy, onClick = {
                scope.launch {
                    busy = true
                    runCatching { target = identities.createEnrollmentTarget(); identities.restore() }
                        .onSuccess { state = it; status = "This device is ready for approval from another trusted device." }
                        .onFailure { status = "Could not prepare this device for approval. Please try again." }
                    busy = false
                }
            }) { Text("Add another device") }
            Text("Each device has its own secure identity. An existing trusted device must approve it; this is not a shared-profile login.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }

        if (!focusedChat && target != null) {
            K3ncryptNotice("This device has its own secure identity. Open K3NCRYPT on an existing trusted device and approve this device there.", K3ncryptNoticeTone.Attention)
        }

        if (!showNewConversation) conversation?.let { active ->
            if (focusedChat) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(k3ncryptContactName(savedConversations.firstOrNull { it.conversationHash == SavedConversationIndex.hash(active.conversationId) }?.label), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                        Text(if (activeVerified) "Verified contact" else "Verify contact", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    K3ncryptStatus(if (activeVerified) "Verified" else "Unverified", positive = activeVerified)
                }
            } else {
                Spacer(Modifier.height(8.dp))
                Text(k3ncryptContactName(savedConversations.firstOrNull { it.conversationHash == SavedConversationIndex.hash(active.conversationId) }?.label), maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
            }
            if (outgoingInvite.isNotBlank()) {
                K3ncryptCard {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Text("Your private invitation", style = MaterialTheme.typography.titleMedium)
                        Text("Share this invitation only with the intended person. It does not verify who they are; compare fingerprints through a separate trusted channel and confirm before trusting the contact.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        InvitationQr(outgoingInvite)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = {
                                sharePrivateInvitation(context, outgoingInvite)
                                status = "Choose a private way to share your invitation."
                            }) { Text("Share invitation") }
                            OutlinedButton(onClick = { clipboard.setText(AnnotatedString(outgoingInvite)); status = "Invitation copied. Share it privately." }) { Text("Copy link") }
                        }
                    }
                }
            }
            LazyColumn(
                modifier = Modifier.fillMaxWidth().then(if (focusedChat) Modifier.weight(1f) else Modifier.height(320.dp)).padding(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val visibleMessages = chatMessages.filter { it.conversationId == active.conversationId }
                if (visibleMessages.isEmpty()) {
                    item {
                        K3ncryptEmptyState("Your conversation starts here", "Messages are end-to-end encrypted and saved on this device.")
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
                                    if (sentByThisDevice) "Sent · ${formatChatTime(message.timestamp)}" else formatChatTime(message.timestamp),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (sentByThisDevice) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.78f) else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
            Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
              Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 7.dp, top = 5.dp, bottom = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                IconButton(enabled = false, onClick = {}, modifier = Modifier.size(40.dp)) {
                    Icon(Icons.Filled.AttachFile, contentDescription = "Attachments are not available yet", tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f))
                }
                OutlinedTextField(draft, { draft = it }, placeholder = { Text("Write a message") }, modifier = Modifier.weight(1f), maxLines = 4, shape = RoundedCornerShape(16.dp))
                IconButton(enabled = false, onClick = {}, modifier = Modifier.size(40.dp)) {
                    Icon(Icons.Filled.Mic, contentDescription = "Voice messages are not available yet", tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f))
                }
                IconButton(enabled = !busy && draft.isNotBlank() && active.peerRoutingId.isNotBlank(), onClick = {
                    val text = draft
                    scope.launch {
                        busy = true
                        messageStatus = "Encrypting and sending…"
                        runCatching { messaging.sendText(text) }
                            .onSuccess { draft = ""; messageStatus = "Message delivered." }
                            .onFailure { messageStatus = "Message not sent. It is saved on this device and can be sent when the connection returns." }
                        busy = false
                    }
                }) {
                    Surface(shape = RoundedCornerShape(14.dp), color = if (draft.isNotBlank()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant) {
                        Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send encrypted message", tint = if (draft.isNotBlank()) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
              }
            }
            Text(
                "File sharing and voice messages are not available in Android chat yet.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 8.dp),
            )
            if (!relayConnected) K3ncryptNotice("Connection interrupted. Saved messages stay on this device while K3NCRYPT tries to reconnect.", K3ncryptNoticeTone.Attention)
            if (messageStatus.isNotBlank()) K3ncryptNotice(messageStatus, k3ncryptNoticeToneFor(messageStatus))
            if (SavedConversationIndex.hasPinnedPeer(active)) {
                if (showAdvancedVerification) {
                    Text("Compare this fingerprint with your contact through another trusted channel. An invitation or received message does not verify identity.")
                    Text("Contact fingerprint: ${active.peerIdentityReference}")
                    OutlinedTextField(fingerprintConfirmation, { fingerprintConfirmation = it }, label = { Text("Confirm contact fingerprint") }, modifier = Modifier.fillMaxWidth(),
                        singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { keyboardController?.hide() }))
                    if (!activeVerified) Button(enabled = !busy && fingerprintConfirmation.trim() == active.peerIdentityReference, onClick = {
                        scope.launch {
                            busy = true
                            runCatching { messaging.verifyActiveContact(fingerprintConfirmation.trim()) }
                                .onSuccess {
                                    fingerprintConfirmation = ""
                                    contactVerificationState = ContactVerificationState.VERIFIED
                                    verifiedBinding = active
                                    savedConversations = messaging.savedConversations()
                                    status = "Contact verified on this device."
                                }.onFailure { status = "Contact could not be verified. Compare the fingerprint again." }
                            busy = false
                        }
                    }) { Text("Confirm verification") }
                    if (activeVerified) {
                    Button(enabled = !busy && fingerprintConfirmation.trim() == active.peerIdentityReference, onClick = {
                        scope.launch {
                            busy = true
                            runCatching { messaging.armVerifiedSessionRenewal(fingerprintConfirmation.trim()) }
                                .onSuccess { fingerprintConfirmation = ""; status = "Verified connection update prepared for ten minutes. Waiting for your contact to reconnect." }
                                .onFailure { status = "Session renewal approval failed; no session state was changed." }
                            busy = false
                        }
                    }) { Text("Prepare verified session renewal") }
                    }
                }
                if (!activeVerified) OutlinedButton(onClick = { showAdvancedVerification = true }) { Text("Verify contact") }
                if (activeVerified) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = callState.callId == null, onClick = { requestCallPermissions("audio") }) { Text("Voice call") }
                    Button(enabled = callState.callId == null, onClick = { requestCallPermissions("video") }) { Text("Video call") }
                }
            }
        }
        }
       } else if (selectedTab == "contacts") {
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            K3ncryptSectionTitle("Your people", "Contacts", "Trusted conversations saved on this device.")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = { selectedTab = "add-contact"; showNewConversation = true }) { Icon(Icons.Filled.Add, contentDescription = null); Spacer(Modifier.size(6.dp)); Text("Add contact") }
                OutlinedButton(onClick = ::scanInvitation) { Text("Scan QR") }
            }
            OutlinedButton(onClick = { selectedTab = "chats"; showNewConversation = true; showConversationList = true; outgoingInvite = "" }) { Text("Create invitation QR") }
            if (savedConversations.isEmpty()) {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                    K3ncryptEmptyState("Your contacts will appear here", "Create or join an invitation to connect. Verify the contact’s fingerprint before trusting them.")
                }
            } else savedConversations.forEach { saved ->
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, tonalElevation = 1.dp) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(saved.label, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                                Text(if (saved.connectionState == "connected") "Connected on this device" else "Saved on this device", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                if (saved.lastActivityTimestamp > 0L) Text("Last message · ${formatChatTime(saved.lastActivityTimestamp)}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                            }
                            K3ncryptStatus(if (saved.trustState == "verified") "Verified" else "Unverified", positive = saved.trustState == "verified")
                        }
                        if (nicknameEditingHash == saved.conversationHash) {
                            OutlinedTextField(nicknameDraft, { nicknameDraft = it }, label = { Text("Contact nickname") }, supportingText = { Text("For recognition on this device only. A nickname does not verify identity.") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(enabled = !busy && nicknameDraft.isNotBlank(), onClick = {
                                    scope.launch {
                                        busy = true
                                        runCatching { messaging.saveContactNickname(saved.conversationHash, nicknameDraft) }
                                            .onSuccess { savedConversations = messaging.savedConversations(); nicknameEditingHash = null; status = "Contact nickname saved on this device." }
                                            .onFailure { status = "Contact nickname could not be saved. Use 1–80 characters." }
                                        busy = false
                                    }
                                }) { Text("Save name") }
                                OutlinedButton(onClick = { nicknameEditingHash = null }) { Text("Cancel") }
                            }
                        } else {
                            OutlinedButton(onClick = { nicknameDraft = saved.label; nicknameEditingHash = saved.conversationHash }) { Text("Edit nickname") }
                        }
                        Button(enabled = !busy, onClick = {
                            scope.launch {
                                busy = true
                                runCatching {
                                    val selected = messaging.selectSavedConversation(saved.conversationHash, ::onMessage, ::onPeerPending)
                                    conversation = selected
                                    outgoingInvite = ""
                                    chatMessages.clear()
                                    appendUniqueChatMessages(chatMessages, messaging.messages().filter { it.conversationId == selected.conversationId })
                                    status = "Conversation ready."
                                    selectedTab = "chats"
                                    showConversationList = false
                                }.onFailure { status = "Saved conversation could not be restored." }
                                busy = false
                            }
                        }) { Text("Open conversation") }
                    }
                }
            }
        }
       } else if (selectedTab == "calls") {
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            K3ncryptSectionTitle("Stay in touch", "Calls", "Start a voice or video call from a trusted conversation.")
            val active = conversation
            if (active == null) {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                    K3ncryptEmptyState("No active conversation", "Choose a contact before starting a call.")
                }
                OutlinedButton(onClick = { selectedTab = "contacts" }) { Text("Open contacts") }
            } else {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                    Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(k3ncryptContactName(savedConversations.firstOrNull { it.conversationHash == SavedConversationIndex.hash(active.conversationId) }?.label), style = MaterialTheme.typography.titleMedium)
                        Text(if (activeVerified && callState.callId == null) "Verified contact" else "Verify contact before calling.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(enabled = !busy && callState.callId == null && activeVerified, onClick = { requestCallPermissions("audio") }) { Text("Voice call") }
                            Button(enabled = !busy && callState.callId == null && activeVerified, onClick = { requestCallPermissions("video") }) { Text("Video call") }
                        }
                        if (callState.callId != null) Text("${callState.mediaMode.replaceFirstChar { it.uppercase() }} call · ${callState.status}")
                    }
                }
            }
            K3ncryptNotice("Call history is not saved on this device yet. Incoming and active calls appear here while they are in progress.")
        }
       } else {
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            K3ncryptSectionTitle("Your device", "Settings", "Choose how K3NCRYPT looks and review this device’s security.")
            K3ncryptCard {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Text("Profile", style = MaterialTheme.typography.titleMedium)
                    Text("Your profile name appears in your space on this device. Contact nicknames are also local to this device. Neither name is part of your cryptographic identity or proves who someone is.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(profileNameDraft, { profileNameDraft = it }, label = { Text("Profile name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Button(enabled = !busy && profileNameDraft.trim().isNotEmpty() && profileNameDraft.trim() != profileName, onClick = {
                        scope.launch {
                            busy = true
                            runCatching { messaging.saveProfileDisplayName(profileNameDraft) }
                                .onSuccess { profileName = it; profileNameDraft = it; status = "Display name saved on this device." }
                                .onFailure { status = "Display name could not be saved. Use 1–40 characters." }
                            busy = false
                        }
                    }) { Text("Save display name") }
                }
            }
            K3ncryptCard {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Text("Devices", style = MaterialTheme.typography.titleMedium)
                    Text("Each device has its own secure identity. This is an approval flow, not a shared-profile login.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Text("1 · Open K3NCRYPT on the new device and choose Add another device.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Text("2 · On the new device, open Advanced details and share its public enrollment details privately. Enter them on this trusted device to request approval.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Text("3 · Review and approve here, then finish confirmation on the new device.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    state?.let { identity ->
                        K3ncryptStatus(when (identity.lifecycleState) {
                            "active" -> "This device is approved"
                            "target-awaiting-approval" -> "Approval needed"
                            "bootstrap-pending" -> "Setup needs a retry"
                            else -> "Setup in progress"
                        }, positive = identity.lifecycleState == "active")
                        if (identity.lifecycleState == "target-awaiting-approval") {
                            Text("Step 3 · Confirm this device after the trusted device approves it.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            OutlinedButton(onClick = { showAdvancedDeviceDetails = !showAdvancedDeviceDetails }) { Text(if (showAdvancedDeviceDetails) "Hide advanced details" else "Advanced details") }
                            if (showAdvancedDeviceDetails) {
                                Text("Share these public enrollment details with the trusted device using a private channel. Never share a passphrase or private key.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                val targetIdentity = target ?: NewDeviceEnrollmentIdentity(identity.deviceId, identity.deviceIdentityReference, IdentityFingerprint.normalize(identity.identity.ed25519), identity.deviceIdentityReference)
                                listOf("Device ID" to targetIdentity.deviceId, "Identity reference" to targetIdentity.deviceIdentityReference, "Verification key" to targetIdentity.verificationKey, "Fingerprint" to targetIdentity.fingerprint).forEach { (label, value) ->
                                    Text(label, style = MaterialTheme.typography.labelLarge)
                                    Text(value, style = MaterialTheme.typography.bodySmall)
                                    OutlinedButton(onClick = { clipboard.setText(AnnotatedString(value)) }) { Text("Copy $label") }
                                }
                                Text("Enter the account reference and pending epoch supplied by the approving device.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                OutlinedTextField(approvedAccountReference, { approvedAccountReference = it }, label = { Text("Account reference") }, modifier = Modifier.fillMaxWidth())
                                OutlinedTextField(approvedPendingEpoch, { approvedPendingEpoch = it }, label = { Text("Pending epoch") }, modifier = Modifier.fillMaxWidth())
                                Button(enabled = !busy && approvedAccountReference.isNotBlank() && approvedPendingEpoch.toLongOrNull() != null && endpoint.isNotBlank(), onClick = {
                                    scope.launch {
                                        busy = true
                                        runCatching { identities.activateApprovedDevice(approvedAccountReference.trim(), approvedPendingEpoch.toLong()) }
                                            .onSuccess { state = it; status = "This device is approved and ready." }
                                            .onFailure { status = "Could not activate this device. Check the approval details and try again." }
                                        busy = false
                                    }
                                }) { Text("Confirm and activate device") }
                            }
                        } else if (identity.lifecycleState == "active") {
                            OutlinedButton(onClick = { showAdvancedDeviceDetails = !showAdvancedDeviceDetails }) { Text(if (showAdvancedDeviceDetails) "Hide advanced details" else "Advanced details") }
                            if (showAdvancedDeviceDetails) {
                                Text("On the new device, open K3NCRYPT and choose Add another device. Enter its public enrollment details here, review the request, then confirm on the new device.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                OutlinedTextField(targetDeviceId, { targetDeviceId = it }, label = { Text("Device ID") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                OutlinedTextField(targetIdentityReference, { targetIdentityReference = it }, label = { Text("Identity reference") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                OutlinedTextField(targetVerificationKey, { targetVerificationKey = it }, label = { Text("Verification key") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                OutlinedTextField(targetFingerprint, { targetFingerprint = it }, label = { Text("Confirm fingerprint") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                Button(enabled = !busy && targetDeviceId.isNotBlank() && endpoint.isNotBlank(), onClick = {
                                    scope.launch {
                                        busy = true
                                        runCatching { identities.approveDevice(NewDeviceEnrollmentIdentity(targetDeviceId.trim(), targetIdentityReference.trim(), targetVerificationKey.trim(), targetFingerprint.trim())) }
                                            .onSuccess { result -> approvedAccountReference = result.getString("accountIdentityReference"); approvedPendingEpoch = result.getLong("trustEpoch").toString(); status = "Approval is ready to confirm on the new device." }
                                            .onFailure { status = "This device request could not be approved. Check the details and try again." }
                                        busy = false
                                    }
                                }) { Text("Review and approve device") }
                                if (approvedAccountReference.isNotBlank()) {
                                    Text("On the new device, enter the approval reference and epoch below.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                    Text("Account reference", style = MaterialTheme.typography.labelLarge)
                                    Text(approvedAccountReference, style = MaterialTheme.typography.bodySmall)
                                    OutlinedButton(onClick = { clipboard.setText(AnnotatedString(approvedAccountReference)) }) { Text("Copy account reference") }
                                    Text("Pending epoch", style = MaterialTheme.typography.labelLarge)
                                    Text(approvedPendingEpoch, style = MaterialTheme.typography.bodySmall)
                                    OutlinedButton(onClick = { clipboard.setText(AnnotatedString(approvedPendingEpoch)) }) { Text("Copy pending epoch") }
                                }
                            }
                        }
                    }
                }
            }
            K3ncryptCard {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
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
                    OutlinedButton(onClick = { showAdvancedNetwork = !showAdvancedNetwork }) { Text(if (showAdvancedNetwork) "Hide advanced details" else "Advanced details") }
                    if (showAdvancedNetwork) {
                        Text("Configure the service this device connects to. Hosted services should use HTTPS.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        OutlinedTextField(endpoint, { endpoint = it }, label = { Text("Service address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(socketEndpoint, { socketEndpoint = it }, label = { Text("Realtime address (if different)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
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
            }
            K3ncryptCard {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Security", style = MaterialTheme.typography.titleMedium)
                    K3ncryptStatus(if (state?.lifecycleState == "active") "This device is approved" else "Device setup required", positive = state?.lifecycleState == "active")
                    Text("Your device identity is separate from your profile name. A contact is verified only after you compare fingerprints and confirm.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(onClick = { showAdvancedVerification = !showAdvancedVerification }) { Text(if (showAdvancedVerification) "Hide advanced details" else "Advanced details") }
                    if (showAdvancedVerification) state?.let { identity ->
                        Text("Device identity fingerprint", style = MaterialTheme.typography.labelLarge)
                        Text(identity.deviceIdentityReference, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            K3ncryptCard {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("Privacy", style = MaterialTheme.typography.titleMedium)
                    Text("Your messages are protected for the people in your trusted conversation. Notification preview controls are not available in this beta yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Text("K3NCRYPT never asks you to share a passphrase or private key.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
            K3ncryptCard {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("About", style = MaterialTheme.typography.titleMedium)
                    Text("Notifications", style = MaterialTheme.typography.labelLarge)
                    Text("Private notification preferences are not available in this beta yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(4.dp))
                    Text("Local storage", style = MaterialTheme.typography.labelLarge)
                    Text("Your encrypted account and saved messages remain on this device.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
       }
       NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
        listOf("chats" to "Chats", "contacts" to "Contacts", "calls" to "Calls", "settings" to "Settings").forEach { (route, label) ->
            NavigationBarItem(
                selected = selectedTab == route || (selectedTab == "add-contact" && route == "contacts"),
                onClick = { selectedTab = route; if (route == "chats") { showNewConversation = false; showConversationList = true } },
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
          enter = fadeIn(animationSpec = tween(K3ncryptMotion.normal)) + scaleIn(initialScale = 0.97f, animationSpec = tween(K3ncryptMotion.normal)),
          exit = fadeOut(animationSpec = tween(K3ncryptMotion.fast)) + scaleOut(targetScale = 0.98f, animationSpec = tween(K3ncryptMotion.fast)),
      ) {
          val callLabel = when (callState.status.lowercase()) {
              "ringing" -> if (callState.incoming) "Incoming call" else "Calling…"
              "connecting" -> "Connecting…"
              "connected" -> "Connected"
              "completed" -> "Call ended"
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
                      Text(if (callState.incoming) "Incoming ${if (callState.mediaMode == "audio") "voice" else "video"} call" else "${if (callState.mediaMode == "audio") "Voice" else "Video"} call", style = MaterialTheme.typography.titleLarge)
                      Text(
                          conversation?.let { active -> savedConversations.firstOrNull { it.conversationHash == SavedConversationIndex.hash(active.conversationId) }?.label }?.let(::k3ncryptContactName) ?: "Contact",
                          color = MaterialTheme.colorScheme.onSurfaceVariant,
                          maxLines = 2,
                          overflow = TextOverflow.Ellipsis,
                      )
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
                                  OutlinedButton(onClick = calls::switchCamera) { Text("Switch camera") }
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
