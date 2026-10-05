package com.k3ncrypt.experiment.localsession

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkAddress
import android.net.Network
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

internal data class WiFiProfile(
    val network: Network,
    val address: Inet4Address,
    val linkAddress: LinkAddress,
    val internet: String,
)

internal class SpikeController(context: Context, private val render: (Snapshot) -> Unit) {
    companion object {
        const val SERVICE_TYPE = "_k3nlsx._tcp."
        private const val SESSION_MS = 10 * 60_000L
        private const val ADVERTISE_MS = 120_000L
        private const val DISCOVERY_MS = 60_000L
        private const val FRAME_TIMEOUT_MS = 2_000
        private const val IDLE_TIMEOUT_MS = 60_000
    }

    private val appContext = context.applicationContext
    private val connectivity = appContext.getSystemService(ConnectivityManager::class.java)
    private val nsd = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val main = Handler(Looper.getMainLooper())
    private val deadlines = LinkedHashSet<Runnable>()
    private val state = ExperimentState()
    private val io = ThreadPoolExecutor(3, 3, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(8)) { task ->
        Thread(task, "local-session-experiment").apply { isDaemon = true }
    }
    private val sender = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(8)) { task ->
        Thread(task, "local-session-send").apply { isDaemon = true }
    }
    private val random = SecureRandom()
    private val attempts = ArrayDeque<Long>()
    private val hints = BoundedHintSet<String, NsdServiceInfo>()
    private val outboundFrames = OutboundFrameQueue()
    private val currentSocketLock = Any()
    private val sendLock = Any()
    @Volatile private var generation = 0
    private var profile: WiFiProfile? = null
    private var hostContext = ByteArray(0)
    private var clientContext = ByteArray(0)
    private var serverSocket: ServerSocket? = null
    private var socket: Socket? = null
    private var registration: NsdManager.RegistrationListener? = null
    private var discovery: NsdManager.DiscoveryListener? = null
    private var pendingAcceptance: CountDownLatch? = null
    private var pendingAccepted = AtomicBoolean(false)
    private var output = BufferedOutputStream(java.io.ByteArrayOutputStream())
    private var sendSequence = 1L
    private var receiveSequence = 1L
    private var sentTextCount = 0
    private var receivedTextCount = 0
    private var lastSendAt = 0L
    private var lastReceiveAt = 0L
    private var inboundQueued = 0
    private var discoveryWindowStart = 0L
    private var discoveryEvents = 0
    private var discoveryOverrunStart = 0L
    private var sessionDeadline: Runnable? = null
    private var advertisingDeadline: Runnable? = null
    private var discoveryDeadline: Runnable? = null

    init {
        io.setKeepAliveTime(30, TimeUnit.SECONDS); io.allowCoreThreadTimeOut(true)
        sender.setKeepAliveTime(30, TimeUnit.SECONDS); sender.allowCoreThreadTimeOut(true)
    }

    fun snapshot(): Snapshot = state.value

    fun networkProfile(): WiFiProfile? = readWiFiProfile()

    fun advertiser() = begin("advertiser") { gen, netProfile ->
        val host = ByteArray(16).also(random::nextBytes)
        hostContext = host
        val address = netProfile.address
        val listener = ServerSocket(0, 1, address)
        if (!isCurrent(gen)) { listener.close(); return@begin }
        serverSocket = listener
        post(gen) { state.updateInternet(netProfile.internet); state.transition(gen, Stage.ADVERTISING, "Advertising on selected Wi-Fi"); publish() }
        submit(gen) { acceptLoop(gen, listener) }
        registerAdvertisement(gen, listener.localPort, host, netProfile)
        advertisingDeadline = schedule(gen, ADVERTISE_MS) {
            advertisingDeadline = null
            stopAdvertisement()
            runCatching { serverSocket?.close() }; serverSocket = null
            if (state.value.stage == Stage.ADVERTISING) finish(gen, Stage.FAILED, SafeReason.SESSION_EXPIRED, "Advertisement window ended")
        }
    }

    fun discover() = begin("discoverer") { gen, netProfile ->
        hostContext = ByteArray(0)
        hints.clear()
        post(gen) { state.updateInternet(netProfile.internet); state.transition(gen, Stage.DISCOVERING, "Discovering on local network"); publish() }
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                main.post {
                    if (!isCurrent(gen) || state.value.stage !in setOf(Stage.DISCOVERING, Stage.PEER_FOUND)) return@post
                    if (normalizeType(serviceInfo.serviceType) != normalizeType(SERVICE_TYPE)) return@post
                    if (serviceInfo.serviceName.toByteArray(Charsets.UTF_8).size > 64 || serviceInfo.serviceType.toByteArray(Charsets.UTF_8).size > 32) return@post
                    val now = android.os.SystemClock.elapsedRealtime()
                    if (now - discoveryWindowStart >= 1_000L) { discoveryWindowStart = now; discoveryEvents = 0 }
                    discoveryEvents++
                    if (discoveryEvents > 20) {
                        if (discoveryOverrunStart == 0L) discoveryOverrunStart = now
                        if (now - discoveryOverrunStart >= 2_000L) finish(gen, Stage.FAILED, SafeReason.RESOURCE_LIMIT, "Discovery event limit reached")
                        return@post
                    } else discoveryOverrunStart = 0L
                    val advertisedContext = parseHostContext(serviceInfo.serviceName)
                    if (advertisedContext.size != 16 || (hostContext.size == 16 && advertisedContext.contentEquals(hostContext))) return@post
                    hints.putIfFresh(serviceInfo.serviceName, serviceInfo, now)
                    state.transition(gen, Stage.PEER_FOUND, "Untrusted endpoint found; select Connect"); publish()
                }
            }
            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                main.post {
                    if (!isCurrent(gen)) return@post
                    hints.remove(serviceInfo.serviceName)
                    if (hints.size(android.os.SystemClock.elapsedRealtime()) == 0 && state.value.stage == Stage.PEER_FOUND) state.transition(gen, Stage.DISCOVERING, "Selected endpoint disappeared")
                    publish()
                }
            }
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                main.post { if (isCurrent(gen)) finish(gen, Stage.FAILED, SafeReason.NSD_START_FAILED, "Discovery could not start") }
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit
        }
        discovery = listener
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, netProfile.network, java.util.concurrent.Executor { command -> main.post(command) }, listener)
            } else {
                nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
            }
        } catch (_: SecurityException) {
            finish(gen, Stage.FAILED, SafeReason.PERMISSION_DENIED, "Local-network access unavailable")
        } catch (_: Throwable) {
            finish(gen, Stage.FAILED, SafeReason.NSD_START_FAILED, "Discovery could not start")
        }
        discoveryDeadline = schedule(gen, DISCOVERY_MS) {
            discoveryDeadline = null
            if (state.value.stage in setOf(Stage.DISCOVERING, Stage.PEER_FOUND)) finish(gen, Stage.FAILED, SafeReason.DISCOVERY_TIMEOUT, "Discovery window ended")
        }
    }

    fun connectSelected() {
        val gen = generation
        if (state.value.stage != Stage.PEER_FOUND) return
        val entry = hints.values(android.os.SystemClock.elapsedRealtime()).firstOrNull() ?: run { finish(gen, Stage.FAILED, SafeReason.NSD_RESOLVE_FAILED, "Endpoint is no longer available"); return }
        val expectedHost = parseHostContext(entry.serviceName)
        if (expectedHost.size != 16 || !reserveAttempt()) { finish(gen, Stage.FAILED, SafeReason.RATE_LIMIT, "Connection attempt limit reached"); return }
        stopDiscovery(gen)
        post(gen) { state.transition(gen, Stage.CONNECTING, "Connecting to an untrusted endpoint"); publish() }
        submit(gen) {
            try {
                val service = resolve(entry, gen)
                val current = readWiFiProfile() ?: error("UNSUPPORTED_NETWORK_PROFILE")
                if (!sameNetwork(profile, current)) error("NETWORK_CHANGED")
                val resolvedAddresses = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    service.hostAddresses
                } else listOfNotNull(service.host)
                val address = resolvedAddresses.filterIsInstance<Inet4Address>()
                    .firstOrNull { isOnLinkPrivate(it, current) && it != current.address }
                    ?: error("UNSUPPORTED_NETWORK_PROFILE")
                require(isOnLinkPrivate(address, current) && address != current.address) { "UNSUPPORTED_NETWORK_PROFILE" }
                require(service.port in 1..65535) { "NSD_RESOLVE_FAILED" }
                val client = Socket()
                current.network.bindSocket(client)
                client.tcpNoDelay = true
                client.connect(java.net.InetSocketAddress(address, service.port), 5_000)
                installSocket(gen, client)
                val input = BufferedInputStream(client.getInputStream())
                val out = BufferedOutputStream(client.getOutputStream())
                LocalSessionProtocol.writePreamble(out)
                val preambleDeadline = android.os.SystemClock.elapsedRealtime() + 5_000L
                readPreambleBefore(client, input, preambleDeadline)
                val localClient = ByteArray(16).also(random::nextBytes)
                clientContext = localClient
                writeFrame(out, LocalSessionProtocol.hello(expectedHost, localClient))
                val accepted = try {
                    readFrameBefore(client, input, android.os.SystemClock.elapsedRealtime() + 30_000L)
                } catch (error: IOException) {
                    if (error.message?.contains("FRAME_TIMEOUT") == true) throw IOException("ACCEPT_TIMEOUT")
                    throw error
                }
                LocalSessionProtocol.validateContext(accepted, LocalSessionProtocol.TYPE_ACCEPT, expectedHost, localClient)
                synchronized(currentSocketLock) { output = out }
                sendSequence = 1L; receiveSequence = 1L; sentTextCount = 0; receivedTextCount = 0
                connected(gen, "Transport connected; unauthenticated")
                readLoop(gen, client, input)
            } catch (error: Throwable) {
                if (isCurrent(gen)) finish(gen, Stage.FAILED, reason(error, SafeReason.NSD_RESOLVE_FAILED), "Could not connect to selected endpoint")
            }
        }
    }

    fun acceptPeer() {
        if (!state.value.canAccept) return
        val latch = pendingAcceptance ?: return
        if (!pendingAccepted.compareAndSet(false, true)) return
        stopAdvertisement()
        runCatching { serverSocket?.close() }; serverSocket = null
        post(generation) { state.transition(generation, Stage.CONNECTING, "User accepted unverified test connection"); publish() }
        latch.countDown()
    }

    fun sendSynthetic(value: String) {
        val gen = generation
        if (!state.value.connected || value !in setOf("PING-A", "PING-B", "HELLO-LOCAL-1", "HELLO-LOCAL-2")) return
        val now = android.os.SystemClock.elapsedRealtime()
        synchronized(currentSocketLock) {
            if (outboundFrames.size() >= 8) { finish(gen, Stage.FAILED, SafeReason.RESOURCE_LIMIT, "Send queue is full"); return }
            if (sentTextCount >= 100 || now - lastSendAt < 100L) { finish(gen, Stage.FAILED, SafeReason.RATE_LIMIT, "Message rate limit reached"); return }
            val frame = LocalSessionProtocol.text(sendSequence, value)
            if (!outboundFrames.offer(frame)) { finish(gen, Stage.FAILED, SafeReason.RESOURCE_LIMIT, "Send queue is full"); return }
            sentTextCount++; sendSequence++; lastSendAt = now
        }
        try {
            sender.execute {
                try {
                    val frame = synchronized(currentSocketLock) {
                        val queued = outboundFrames.take() ?: return@execute
                        if (!isCurrent(gen)) return@execute
                        queued
                    }
                    val out = synchronized(currentSocketLock) { output }
                    synchronized(sendLock) { if (isCurrent(gen)) writeFrame(out, frame) }
                    post(gen) { state.append(gen, "Sent: $value (test socket)"); publish() }
                } catch (_: Throwable) {
                    if (isCurrent(gen)) finish(gen, Stage.FAILED, SafeReason.PEER_DISCONNECTED, "Connection ended")
                }
            }
        } catch (_: Throwable) { finish(gen, Stage.FAILED, SafeReason.RESOURCE_LIMIT, "Send queue is full") }
    }

    fun stop() {
        val old = generation
        state.stop(SafeReason.USER_ENDED)
        generation = state.value.generation
        closeResources(old)
        clearMemory()
        publish()
    }

    fun dispose() {
        stop()
        io.shutdownNow()
        sender.shutdownNow()
    }

    fun onBackground() {
        val gen = generation
        if (state.value.stage !in setOf(Stage.INACTIVE, Stage.DISCONNECTED, Stage.FAILED)) finish(gen, Stage.DISCONNECTED, SafeReason.BACKGROUNDED, "Stopped when app left foreground")
    }

    fun onNetworkChanged() {
        val gen = generation
        val expected = profile ?: return
        val current = readWiFiProfile()
        post(gen) { state.updateInternet(current?.internet ?: "unavailable"); publish() }
        if (current == null || !sameNetwork(expected, current)) finish(gen, Stage.DISCONNECTED, SafeReason.NETWORK_CHANGED, "Selected Wi-Fi changed; restart manually")
    }

    private fun begin(role: String, action: (Int, WiFiProfile) -> Unit) {
        stop()
        val selected = readWiFiProfile()
        if (selected == null) {
            generation = state.failBeforeStart(SafeReason.UNSUPPORTED_NETWORK_PROFILE, "Wi-Fi unavailable or unsupported")
            publish(); return
        }
        profile = selected
        generation = state.begin(role)
        publish()
        val gen = generation
        sessionDeadline = schedule(gen, SESSION_MS) {
            sessionDeadline = null
            finish(gen, Stage.FAILED, SafeReason.SESSION_EXPIRED, "Session expired")
        }
        try { action(gen, selected) } catch (error: Throwable) {
            finish(gen, Stage.FAILED, reason(error, SafeReason.RESOURCE_LIMIT), "Experiment could not start")
        }
    }

    private fun registerAdvertisement(gen: Int, port: Int, host: ByteArray, selected: WiFiProfile) {
        val name = "lsx-${host.joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }}"
        val info = NsdServiceInfo().apply {
            serviceName = name
            serviceType = SERVICE_TYPE
            setPort(port)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setNetwork(selected.network)
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                main.post { if (isCurrent(gen)) finish(gen, Stage.FAILED, SafeReason.NSD_START_FAILED, "Advertisement could not start") }
            }
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) = Unit
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) = Unit
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit
        }
        registration = listener
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, java.util.concurrent.Executor { command -> main.post(command) }, listener)
            } else nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
        }
        catch (_: SecurityException) { finish(gen, Stage.FAILED, SafeReason.PERMISSION_DENIED, "Local-network access unavailable") }
        catch (_: Throwable) { finish(gen, Stage.FAILED, SafeReason.NSD_START_FAILED, "Advertisement could not start") }
    }

    private fun acceptLoop(gen: Int, listener: ServerSocket) {
        while (isCurrent(gen) && !listener.isClosed) {
            var candidate: Socket? = null
            try {
                val accepted = listener.accept()
                candidate = accepted
                if (!reserveAttempt()) { accepted.close(); post(gen) { finish(gen, Stage.FAILED, SafeReason.RATE_LIMIT, "Connection attempt limit reached") }; return }
                val alreadyBusy = synchronized(currentSocketLock) {
                    if (socket != null || pendingAcceptance != null) true else { socket = accepted; false }
                }
                if (alreadyBusy) { accepted.close(); continue }
                if (!sameNetwork(profile, readWiFiProfile())) { accepted.close(); finish(gen, Stage.DISCONNECTED, SafeReason.NETWORK_CHANGED, "Selected Wi-Fi changed"); return }
                val peerAddress = accepted.inetAddress as? Inet4Address
                val currentProfile = profile ?: error("UNSUPPORTED_NETWORK_PROFILE")
                require(peerAddress != null && isOnLinkPrivate(peerAddress, currentProfile)) { "UNSUPPORTED_NETWORK_PROFILE" }
                val input = BufferedInputStream(accepted.getInputStream())
                val out = BufferedOutputStream(accepted.getOutputStream())
                LocalSessionProtocol.writePreamble(out)
                val handshakeDeadline = android.os.SystemClock.elapsedRealtime() + 5_000L
                readPreambleBefore(accepted, input, handshakeDeadline)
                val hello = readFrameBefore(accepted, input, handshakeDeadline)
                if (hello.body.size != 32) error("CONTEXT_MISMATCH")
                val clientId = hello.body.copyOfRange(16, 32)
                val host = hostContext
                LocalSessionProtocol.validateContext(hello, LocalSessionProtocol.TYPE_HELLO, host, clientId)
                if (clientId.size != 16) error("CONTEXT_MISMATCH")
                clientContext = clientId
                val latch = CountDownLatch(1)
                pendingAccepted = AtomicBoolean(false)
                pendingAcceptance = latch
                post(gen) { state.transition(gen, Stage.WAITING_ACCEPTANCE, "Untrusted endpoint; explicit acceptance required"); publish() }
                accepted.soTimeout = 30_000
                if (!latch.await(30, TimeUnit.SECONDS) || !pendingAccepted.get() || !isCurrent(gen)) error("ACCEPT_TIMEOUT")
                writeFrame(out, LocalSessionProtocol.accept(host, clientId))
                synchronized(currentSocketLock) { output = out; pendingAcceptance = null }
                sendSequence = 1L; receiveSequence = 1L; sentTextCount = 0; receivedTextCount = 0
                connected(gen, "User accepted; unauthenticated transport")
                readLoop(gen, accepted, input)
                return
            } catch (error: Throwable) {
                runCatching { candidate?.close() }
                synchronized(currentSocketLock) { if (socket === candidate) socket = null }
                if (isCurrent(gen)) {
                    val stage = state.value.stage
                    pendingAcceptance?.countDown(); pendingAcceptance = null; pendingAccepted.set(false)
                    if (stage == Stage.WAITING_ACCEPTANCE || stage == Stage.CONNECTING || stage == Stage.CONNECTED) {
                        finish(gen, Stage.FAILED, reason(error, SafeReason.FRAME_INVALID), "Untrusted connection closed")
                        return
                    }
                    if (stage == Stage.ADVERTISING && candidate != null) continue
                    if (stage == Stage.ADVERTISING && !listener.isClosed) {
                        finish(gen, Stage.FAILED, reason(error, SafeReason.RESOURCE_LIMIT), "Local listener stopped")
                    }
                }
                return
            }
        }
    }

    private fun readLoop(gen: Int, active: Socket, input: BufferedInputStream) {
        var lastActivity = android.os.SystemClock.elapsedRealtime()
        while (isCurrent(gen) && !active.isClosed) {
            active.soTimeout = IDLE_TIMEOUT_MS
            val first = try { input.read() } catch (_: java.net.SocketTimeoutException) { throw IOException("IDLE_TIMEOUT") }
            if (first < 0) throw IOException("PEER_DISCONNECTED")
            active.soTimeout = FRAME_TIMEOUT_MS
            val header = ByteArray(4); header[0] = first.toByte(); java.io.DataInputStream(input).readFully(header, 1, 3)
            val size = java.nio.ByteBuffer.wrap(header).order(java.nio.ByteOrder.BIG_ENDIAN).int
            if (size !in 1..LocalSessionProtocol.maxPayload) throw IOException("FRAME_TOO_LARGE")
            val payload = ByteArray(size); java.io.DataInputStream(input).readFully(payload)
            val frame = LocalSessionProtocol.Frame(payload[0], payload.copyOfRange(1, payload.size))
            when (frame.type) {
                LocalSessionProtocol.TYPE_TEXT -> {
                    val value = LocalSessionProtocol.decodeText(frame, receiveSequence)
                    val now = android.os.SystemClock.elapsedRealtime()
                    if (now - lastActivity > IDLE_TIMEOUT_MS || now - lastReceiveAt < 100L) throw IOException("RATE_LIMIT")
                    if (receivedTextCount >= 100) throw IOException("RATE_LIMIT")
                    receiveSequence++; receivedTextCount++; lastReceiveAt = now; lastActivity = now
                    synchronized(currentSocketLock) {
                        if (inboundQueued >= 16) throw IOException("RESOURCE_LIMIT")
                        inboundQueued++
                    }
                    main.post {
                        try { if (isCurrent(gen)) { state.append(gen, "Received: $value (test memory)"); publish() } }
                        finally { synchronized(currentSocketLock) { inboundQueued = (inboundQueued - 1).coerceAtLeast(0) } }
                    }
                }
                LocalSessionProtocol.TYPE_CLOSE -> { LocalSessionProtocol.validateClose(frame); throw IOException("PEER_DISCONNECTED") }
                else -> throw IOException("UNEXPECTED_MESSAGE")
            }
        }
    }

    private fun connected(gen: Int, message: String) {
        post(gen) { state.transition(gen, Stage.CONNECTED, message); publish() }
    }

    private fun installSocket(gen: Int, candidate: Socket) {
        synchronized(currentSocketLock) {
            check(isCurrent(gen) && socket == null) { "RESOURCE_LIMIT" }
            socket = candidate
        }
    }

    private fun resolve(info: NsdServiceInfo, gen: Int): NsdServiceInfo {
        val latch = CountDownLatch(1)
        var result: NsdServiceInfo? = null
        var failure: Throwable? = null
        val callback = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) { failure = IOException("NSD_RESOLVE_FAILED"); latch.countDown() }
            override fun onServiceResolved(serviceInfo: NsdServiceInfo) { result = serviceInfo; latch.countDown() }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            nsd.resolveService(info, java.util.concurrent.Executor { command -> main.post(command) }, callback)
        } else nsd.resolveService(info, callback)
        if (!latch.await(5, TimeUnit.SECONDS) || !isCurrent(gen)) throw IOException("RESOLVE_TIMEOUT")
        failure?.let { throw it }
        return result ?: throw IOException("NSD_RESOLVE_FAILED")
    }

    /** Absolute monotonic deadlines prevent slow byte-at-a-time peers extending a handshake. */
    private fun readPreambleBefore(active: Socket, input: BufferedInputStream, deadline: Long) {
        val bytes = readExactBefore(active, input, LocalSessionProtocol.preamble.size, deadline)
        require(bytes.contentEquals(LocalSessionProtocol.preamble)) { "BAD_MAGIC" }
    }

    private fun readFrameBefore(active: Socket, input: BufferedInputStream, deadline: Long): LocalSessionProtocol.Frame {
        val header = readExactBefore(active, input, 4, deadline)
        val size = java.nio.ByteBuffer.wrap(header).order(java.nio.ByteOrder.BIG_ENDIAN).int
        require(size in 1..LocalSessionProtocol.maxPayload) { "FRAME_TOO_LARGE" }
        val bytes = readExactBefore(active, input, size, deadline)
        return LocalSessionProtocol.Frame(bytes[0], bytes.copyOfRange(1, bytes.size))
    }

    private fun readExactBefore(active: Socket, input: BufferedInputStream, count: Int, deadline: Long): ByteArray {
        val bytes = ByteArray(count)
        var offset = 0
        while (offset < count) {
            val remaining = deadline - android.os.SystemClock.elapsedRealtime()
            if (remaining <= 0L) throw IOException("FRAME_TIMEOUT")
            active.soTimeout = remaining.coerceAtMost(Int.MAX_VALUE.toLong()).toInt().coerceAtLeast(1)
            val read = try { input.read(bytes, offset, count - offset) }
            catch (_: java.net.SocketTimeoutException) { throw IOException("FRAME_TIMEOUT") }
            if (read < 0) throw IOException("PEER_DISCONNECTED")
            offset += read
        }
        return bytes
    }

    private fun readWiFiProfile(): WiFiProfile? {
        return try {
            val network = connectivity.activeNetwork ?: return null
            val caps = connectivity.getNetworkCapabilities(network) ?: return null
            if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return null
            // Older NSD APIs browse without a Network scope. Require mobile data/VPN
            // off so legacy discovery cannot silently span another active transport.
            if (connectivity.allNetworks.any { other ->
                    other != network && connectivity.getNetworkCapabilities(other)?.let { otherCaps ->
                        otherCaps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) || otherCaps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
                    } == true
                }) return null
            val links = connectivity.getLinkProperties(network)?.linkAddresses.orEmpty()
            val ipv4 = links.firstOrNull { (it.address as? Inet4Address)?.let(::isPrivateV4) == true } ?: return null
            val address = ipv4.address as Inet4Address
            val internet = when {
                !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) -> "unavailable"
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) -> "available (Android validated)"
                else -> "unknown"
            }
            WiFiProfile(network, address, ipv4, internet)
        } catch (_: SecurityException) { null } catch (_: Throwable) { null }
    }

    private fun isPrivateV4(address: Inet4Address): Boolean {
        val bytes = address.address.map { it.toInt() and 0xff }
        return (bytes[0] == 10) || (bytes[0] == 172 && bytes[1] in 16..31) || (bytes[0] == 192 && bytes[1] == 168)
    }

    private fun isOnLinkPrivate(address: Inet4Address, selected: WiFiProfile): Boolean {
        if (!isPrivateV4(address) || address.isAnyLocalAddress || address.isLoopbackAddress || address.isMulticastAddress) return false
        val bytes = address.address
        val local = selected.address.address
        val prefix = selected.linkAddress.prefixLength
        for (index in 0 until 4) {
            val bits = (prefix - index * 8).coerceIn(0, 8)
            val mask = if (bits == 0) 0 else (0xff shl (8 - bits)) and 0xff
            if ((bytes[index].toInt() and mask) != (local[index].toInt() and mask)) return false
        }
        return true
    }

    private fun sameNetwork(a: WiFiProfile?, b: WiFiProfile?): Boolean =
        a != null && b != null && a.network == b.network && a.address == b.address && a.linkAddress.prefixLength == b.linkAddress.prefixLength

    private fun reserveAttempt(): Boolean = synchronized(attempts) {
        val now = android.os.SystemClock.elapsedRealtime()
        while (attempts.isNotEmpty() && now - attempts.first() >= 60_000L) attempts.removeFirst()
        if (attempts.size >= 6) false else { attempts.addLast(now); true }
    }

    private fun writeFrame(out: BufferedOutputStream, frame: ByteArray) {
        out.write(frame); out.flush()
    }

    private fun submit(gen: Int, work: () -> Unit) {
        try { io.execute { if (isCurrent(gen)) work() } }
        catch (_: Throwable) { finish(gen, Stage.FAILED, SafeReason.RESOURCE_LIMIT, "Experiment resources are full") }
    }

    private fun schedule(gen: Int, delay: Long, action: () -> Unit): Runnable {
        lateinit var job: Runnable
        job = Runnable {
            deadlines.remove(job)
            if (isCurrent(gen)) action()
        }
        deadlines.add(job)
        main.postDelayed(job, delay)
        return job
    }

    private fun cancelDeadline(job: Runnable?) {
        if (job == null) return
        main.removeCallbacks(job)
        deadlines.remove(job)
    }

    private fun post(gen: Int, action: () -> Unit) {
        main.post { if (isCurrent(gen)) action() }
    }

    private fun isCurrent(gen: Int) = gen == generation

    private fun finish(gen: Int, stage: Stage, reason: SafeReason, message: String) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post { finish(gen, stage, reason, message) }
            return
        }
        if (!isCurrent(gen)) return
        state.transition(gen, stage, message, reason)
        generation = state.invalidateGeneration()
        closeResources(gen)
        clearMemory()
        publish()
    }

    private fun stopDiscovery(gen: Int) {
        cancelDeadline(discoveryDeadline); discoveryDeadline = null
        val active = discovery ?: return
        discovery = null
        runCatching { nsd.stopServiceDiscovery(active) }
        if (isCurrent(gen)) Unit
    }

    private fun stopAdvertisement() {
        cancelDeadline(advertisingDeadline); advertisingDeadline = null
        registration?.let { runCatching { nsd.unregisterService(it) } }
        registration = null
    }

    private fun closeResources(gen: Int) {
        deadlines.forEach(main::removeCallbacks)
        deadlines.clear()
        sessionDeadline = null; advertisingDeadline = null; discoveryDeadline = null
        stopDiscovery(gen)
        stopAdvertisement()
        pendingAcceptance?.countDown(); pendingAcceptance = null
        synchronized(currentSocketLock) {
            runCatching { socket?.close() }; socket = null
            runCatching { serverSocket?.close() }; serverSocket = null
            outboundFrames.clear(); inboundQueued = 0
            output = BufferedOutputStream(java.io.ByteArrayOutputStream())
        }
        sender.queue.clear()
        if (gen != generation) { /* captured callbacks are fenced by generation */ }
    }

    private fun clearMemory() {
        hostContext.fill(0); clientContext.fill(0); hostContext = ByteArray(0); clientContext = ByteArray(0)
        hints.clear(); pendingAccepted.set(false); sendSequence = 1; receiveSequence = 1; sentTextCount = 0; receivedTextCount = 0
        lastSendAt = 0; lastReceiveAt = 0; profile = null
        discoveryWindowStart = 0; discoveryEvents = 0; discoveryOverrunStart = 0
    }

    private fun publish() { render(state.value) }

    private fun reason(error: Throwable, fallback: SafeReason): SafeReason = when {
        error.message?.contains("BAD_MAGIC") == true -> SafeReason.BAD_MAGIC
        error.message?.contains("BAD_VERSION") == true -> SafeReason.BAD_VERSION
        error.message?.contains("FRAME_TOO_LARGE") == true -> SafeReason.FRAME_TOO_LARGE
        error.message?.contains("FRAME_TIMEOUT") == true -> SafeReason.FRAME_TIMEOUT
        error.message?.contains("FRAME_INVALID") == true -> SafeReason.FRAME_INVALID
        error.message?.contains("CONTEXT_MISMATCH") == true -> SafeReason.CONTEXT_MISMATCH
        error.message?.contains("RATE_LIMIT") == true -> SafeReason.RATE_LIMIT
        error.message?.contains("UNEXPECTED_MESSAGE") == true -> SafeReason.UNEXPECTED_MESSAGE
        error.message?.contains("NETWORK_CHANGED") == true -> SafeReason.NETWORK_CHANGED
        error.message?.contains("UNSUPPORTED_NETWORK_PROFILE") == true -> SafeReason.UNSUPPORTED_NETWORK_PROFILE
        error.message?.contains("ACCEPT_TIMEOUT") == true -> SafeReason.ACCEPT_TIMEOUT
        error.message?.contains("RESOLVE_TIMEOUT") == true -> SafeReason.RESOLVE_TIMEOUT
        error.message?.contains("IDLE_TIMEOUT") == true -> SafeReason.FRAME_TIMEOUT
        error.message?.contains("CONNECT_TIMEOUT") == true || error is java.net.SocketTimeoutException -> SafeReason.CONNECT_TIMEOUT
        error.message?.contains("PEER_DISCONNECTED") == true || error is IOException -> SafeReason.PEER_DISCONNECTED
        else -> fallback
    }

    private fun parseHostContext(name: String): ByteArray {
        val match = Regex("^lsx-([0-9a-f]{32})(?: \\(\\d+\\))?$", RegexOption.IGNORE_CASE).matchEntire(name) ?: return ByteArray(0)
        return match.groupValues[1].chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    private fun normalizeType(value: String) = value.trimEnd('.').lowercase()
}
