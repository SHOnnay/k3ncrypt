package com.k3ncrypt.experiment.localsession

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.SecureRandom
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.AEADBadTagException
import org.junit.Assert.*
import org.junit.Test

/** Real TCP loopback coverage for the production v2 handshake, state machine, and text channel. */
class LocalSessionLoopbackIntegrationTest {
    @Test fun freshLoopbackHandshakeAndBidirectionalTextSucceedOneHundredTimes() {
        val seenCodes = HashSet<String>()
        repeat(100) { iteration ->
            val code = LocalSessionCrypto.generatePairingCode(SecureRandom())
            assertTrue(seenCodes.add(code))
            LoopbackSession(code).use { session ->
                session.assertBothSecure()
                assertEquals(code, session.advertiserCode)
                assertEquals(code, session.discovererCode)
                assertNull(session.advertiser.state.value.pairingCode)
                assertEquals("PING-A-$iteration", session.sendText(session.discoverer, session.advertiser, "PING-A-$iteration"))
                assertEquals("PING-B-$iteration", session.sendText(session.advertiser, session.discoverer, "PING-B-$iteration"))
                session.closeBoth()
                assertFalse(session.advertiser.secureConnected)
                assertFalse(session.discoverer.secureConnected)
                assertFalse(session.advertiser.channel?.active ?: false)
                assertFalse(session.discoverer.channel?.active ?: false)
            }
        }
    }

    @Test fun wrongPairingCodeFailsBeforeReadyAndClearsTemporaryState() {
        val correct = LocalSessionCrypto.generatePairingCode(SecureRandom())
        val wrong = differentCode(correct)
        LoopbackSession(correct, discovererCode = wrong).use { session ->
            assertFalse(session.advertiser.secureConnected)
            assertFalse(session.discoverer.secureConnected)
            assertEquals(LocalSessionHandshake.Phase.FAILED, session.advertiser.handshake?.phase)
            assertEquals(LocalSessionHandshake.Phase.FAILED, session.discoverer.handshake?.phase)
            assertNull(session.advertiser.state.value.pairingCode)
            assertNull(session.discoverer.state.value.pairingCode)
            assertTrue(session.advertiser.failure?.contains("PAIRING_AUTH_FAILED") == true)
            assertFalse(session.link.wasWritten(Peer.ADVERTISER, LocalSessionProtocol.TYPE_READY_ACK))
        }
    }

    @Test fun authAcceptReadyAndReadyAckProofTamperingNeverConnectsDiscoverer() {
        val code = LocalSessionCrypto.generatePairingCode(SecureRandom())
        val cases = listOf(
            WireKey(Peer.DISCOVERER, LocalSessionProtocol.TYPE_AUTH),
            WireKey(Peer.ADVERTISER, LocalSessionProtocol.TYPE_ACCEPT),
            WireKey(Peer.DISCOVERER, LocalSessionProtocol.TYPE_READY),
            WireKey(Peer.ADVERTISER, LocalSessionProtocol.TYPE_READY_ACK),
        )
        for (key in cases) {
            LoopbackSession(code, fault = LinkFault(tamper = setOf(key))).use { session ->
                assertFalse("discoverer must reject the altered proof at $key", session.discoverer.secureConnected)
                assertFalse("both sides must not establish on altered proof at $key", session.advertiser.secureConnected && session.discoverer.secureConnected)
                session.closeBoth()
                assertFalse(session.advertiser.secureConnected)
                assertFalse(session.discoverer.secureConnected)
            }
        }
    }

    @Test fun lostReadyAndLostReadyAckHaveDistinctBoundedOutcomes() {
        val code = LocalSessionCrypto.generatePairingCode(SecureRandom())
        LoopbackSession(code, fault = LinkFault(drop = setOf(WireKey(Peer.DISCOVERER, LocalSessionProtocol.TYPE_READY)))).use { session ->
            assertFalse(session.advertiser.secureConnected)
            assertFalse(session.discoverer.secureConnected)
            assertEquals(LocalSessionHandshake.Phase.FAILED, session.advertiser.handshake?.phase)
            assertEquals(LocalSessionHandshake.Phase.FAILED, session.discoverer.handshake?.phase)
            assertFalse(session.link.wasWritten(Peer.ADVERTISER, LocalSessionProtocol.TYPE_READY_ACK))
        }

        LoopbackSession(code, fault = LinkFault(drop = setOf(WireKey(Peer.ADVERTISER, LocalSessionProtocol.TYPE_READY_ACK)))).use { session ->
            // The advertiser's READY_ACK output write succeeds locally. The discoverer times out,
            // closes the socket, and the advertiser's normal read loop then clears this state.
            assertTrue("advertiser locally completed its READY_ACK write", session.advertiser.secureConnected)
            assertFalse("discoverer did not verify READY_ACK", session.discoverer.secureConnected)
            assertEquals(LocalSessionHandshake.Phase.CONNECTED, session.advertiser.handshake?.phase)
            assertEquals(LocalSessionHandshake.Phase.FAILED, session.discoverer.handshake?.phase)
            assertTrue(session.advertiser.channel?.active == true)
            assertNull(session.discoverer.channel)
            session.observePeerDisconnect(session.advertiser)
            assertFalse(session.advertiser.secureConnected)
            assertFalse(session.advertiser.channel?.active ?: false)
        }
    }

    @Test fun closingAtEachHandshakeBoundaryAlwaysCleansUp() {
        val code = LocalSessionCrypto.generatePairingCode(SecureRandom())
        val boundaries = listOf(
            WireKey(Peer.DISCOVERER, LocalSessionProtocol.TYPE_HELLO),
            WireKey(Peer.ADVERTISER, LocalSessionProtocol.TYPE_CHALLENGE),
            WireKey(Peer.DISCOVERER, LocalSessionProtocol.TYPE_AUTH),
            WireKey(Peer.ADVERTISER, LocalSessionProtocol.TYPE_ACCEPT),
            WireKey(Peer.DISCOVERER, LocalSessionProtocol.TYPE_READY),
            WireKey(Peer.ADVERTISER, LocalSessionProtocol.TYPE_READY_ACK),
        )
        for (boundary in boundaries) {
            LoopbackSession(code, fault = LinkFault(closeAfter = setOf(boundary))).use { session ->
                when (boundary.type) {
                    LocalSessionProtocol.TYPE_READY -> {
                        assertFalse("discoverer closed immediately after READY", session.discoverer.secureConnected)
                        assertTrue("advertiser completes its local ACK write before noticing peer close", session.advertiser.secureConnected)
                        session.observePeerDisconnect(session.advertiser)
                        session.discoverer.clear()
                    }
                    LocalSessionProtocol.TYPE_READY_ACK -> {
                        assertTrue("READY_ACK reached discoverer before transport close", session.advertiser.secureConnected)
                        assertTrue("discoverer verified READY_ACK before transport close", session.discoverer.secureConnected)
                        session.observePeerDisconnect(session.advertiser)
                        session.observePeerDisconnect(session.discoverer)
                    }
                    else -> session.closeBoth()
                }
                assertFalse("advertiser after close at $boundary", session.advertiser.secureConnected)
                assertFalse("discoverer after close at $boundary", session.discoverer.secureConnected)
                assertFalse(session.advertiser.channel?.active ?: false)
                assertFalse(session.discoverer.channel?.active ?: false)
            }
        }
    }

    @Test fun acceptanceWaitExpiresWithoutCreatingAUsableSession() {
        val code = LocalSessionCrypto.generatePairingCode(SecureRandom())
        LoopbackSession(code, acceptanceWaitMs = 100).use { session ->
            assertFalse(session.advertiser.secureConnected)
            assertFalse(session.discoverer.secureConnected)
            assertEquals(Stage.FAILED, session.advertiser.state.value.stage)
            assertEquals(Stage.FAILED, session.discoverer.state.value.stage)
            assertEquals(LocalSessionHandshake.Phase.FAILED, session.advertiser.handshake?.phase)
            assertFalse(session.link.wasWritten(Peer.ADVERTISER, LocalSessionProtocol.TYPE_ACCEPT))
        }
    }

    @Test fun ciphertextTagSequenceDirectionAndDuplicateReplayAreRejected() {
        val code = LocalSessionCrypto.generatePairingCode(SecureRandom())
        for (tamper in listOf(Tamper.CIPHERTEXT, Tamper.TAG)) {
            LoopbackSession(code).use { session ->
                session.assertBothSecure()
                val encoded = session.discoverer.channel!!.encodeText("SECRET-$tamper")
                val frame = LocalSessionProtocol.readFrame(ByteArrayInputStream(encoded))
                val body = frame.body.copyOf()
                val index = if (tamper == Tamper.CIPHERTEXT) 8 else body.lastIndex
                body[index] = (body[index].toInt() xor 1).toByte()
                assertThrows(AEADBadTagException::class.java) {
                    session.advertiser.channel!!.decodeText(LocalSessionProtocol.Frame(frame.type, body))
                }
                // The bad frame was not accepted or allowed to advance receive order.
                assertEquals("SECRET-$tamper", session.receiveEncoded(session.advertiser, encoded))
            }
        }

        LoopbackSession(code).use { session ->
            session.assertBothSecure()
            val frame = LocalSessionProtocol.readFrame(ByteArrayInputStream(session.discoverer.channel!!.encodeText("PING")))
            val changedSequence = frame.body.copyOf().also { it[7] = (it[7].toInt() xor 1).toByte() }
            assertThrows(IllegalArgumentException::class.java) {
                session.advertiser.channel!!.decodeText(LocalSessionProtocol.Frame(frame.type, changedSequence))
            }
            assertThrows(AEADBadTagException::class.java) { session.discoverer.channel!!.decodeText(frame) }
            assertEquals("PING", session.advertiser.channel!!.decodeText(frame))
        }

        LoopbackSession(code).use { session ->
            session.assertBothSecure()
            val first = session.discoverer.channel!!.encodeText("ONE")
            assertEquals("ONE", session.receiveEncoded(session.advertiser, first))
            assertThrows(IllegalArgumentException::class.java) { session.receiveEncoded(session.advertiser, first) }
            val second = session.discoverer.channel!!.encodeText("TWO")
            assertEquals("TWO", session.receiveEncoded(session.advertiser, second))
            assertThrows(IllegalArgumentException::class.java) { session.receiveEncoded(session.advertiser, first) }
        }
    }

    @Test fun priorSessionCiphertextAndAllPriorControlFramesAreRejected() {
        val code = LocalSessionCrypto.generatePairingCode(SecureRandom())
        val savedFrames: Map<WireKey, ByteArray>
        val oldCiphertext: ByteArray
        LoopbackSession(code).use { previous ->
            previous.assertBothSecure()
            oldCiphertext = previous.discoverer.channel!!.encodeText("OLD-SESSION")
            savedFrames = previous.link.capturedFrames()
        }

        for (type in listOf(
            LocalSessionProtocol.TYPE_HELLO,
            LocalSessionProtocol.TYPE_CHALLENGE,
            LocalSessionProtocol.TYPE_AUTH,
            LocalSessionProtocol.TYPE_ACCEPT,
            LocalSessionProtocol.TYPE_READY,
            LocalSessionProtocol.TYPE_READY_ACK,
        )) {
            val sender = if (type == LocalSessionProtocol.TYPE_HELLO || type == LocalSessionProtocol.TYPE_AUTH || type == LocalSessionProtocol.TYPE_READY) Peer.DISCOVERER else Peer.ADVERTISER
            val key = WireKey(sender, type)
            LoopbackSession(code, fault = LinkFault(replay = mapOf(key to savedFrames.getValue(key)))).use { fresh ->
                assertFalse("both endpoints cannot establish from old control frame $key", fresh.advertiser.secureConnected && fresh.discoverer.secureConnected)
                fresh.closeBoth()
                assertFalse(fresh.advertiser.secureConnected)
                assertFalse(fresh.discoverer.secureConnected)
            }
        }

        LoopbackSession(code).use { fresh ->
            fresh.assertBothSecure()
            assertThrows(AEADBadTagException::class.java) { fresh.receiveEncoded(fresh.advertiser, oldCiphertext) }
            assertEquals("FRESH", fresh.sendText(fresh.discoverer, fresh.advertiser, "FRESH"))
        }
    }

    @Test fun activeDisconnectClearsChannelsAndRestartFencesOldGeneration() {
        val code = LocalSessionCrypto.generatePairingCode(SecureRandom())
        val oldFrame: ByteArray
        val restartState: ExperimentState
        val oldGeneration: Int
        LoopbackSession(code).use { session ->
            session.assertBothSecure()
            oldGeneration = session.discoverer.generation
            oldFrame = session.discoverer.channel!!.encodeText("FROM-OLD")
            session.discoverer.socket!!.close()
            session.discoverer.clear()
            session.observePeerDisconnect(session.advertiser)
            assertFalse(session.advertiser.secureConnected)
            assertFalse(session.discoverer.secureConnected)
            assertFalse(session.advertiser.channel?.active ?: false)
            assertFalse(session.discoverer.channel?.active ?: false)
            assertNull(session.discoverer.state.value.pairingCode)
            assertFalse(session.discoverer.state.append(oldGeneration, "late callback"))
            restartState = session.discoverer.state
        }

        restartState.stop(SafeReason.USER_ENDED)
        val newGeneration = restartState.begin("discoverer")
        assertTrue(newGeneration > oldGeneration)
        restartState.annotate(oldGeneration, "stale old callback")
        assertEquals("Started", restartState.value.event)

        LoopbackSession(code).use { fresh ->
            fresh.assertBothSecure()
            assertThrows(AEADBadTagException::class.java) { fresh.receiveEncoded(fresh.advertiser, oldFrame) }
        }
    }

    @Test fun connectedSessionExpiryDisablesEncryptionAndClearsTemporarySnapshot() {
        val code = LocalSessionCrypto.generatePairingCode(SecureRandom())
        LoopbackSession(code).use { session ->
            session.assertBothSecure()
            for (endpoint in listOf(session.advertiser, session.discoverer)) {
                val generation = endpoint.generation
                assertTrue(endpoint.state.expire(generation))
                endpoint.channel?.close()
                val cleanupGeneration = endpoint.state.invalidateGeneration()
                endpoint.generation = cleanupGeneration
                endpoint.state.clearTemporaryData(cleanupGeneration)
                assertEquals(Stage.FAILED, endpoint.state.value.stage)
                assertFalse(endpoint.state.value.pairingVerified)
                assertFalse(endpoint.state.value.encryptionActive)
                assertFalse(endpoint.channel?.active ?: false)
            }
        }
    }

    @Test fun sequenceOneHundredIsAcceptedAndAttempt101IsRejected() {
        val code = LocalSessionCrypto.generatePairingCode(SecureRandom())
        LoopbackSession(code).use { session ->
            session.assertBothSecure()
            repeat(LocalSessionProtocol.maxMessagesPerSession) { index ->
                val text = "M${index + 1}"
                assertEquals(text, session.sendText(session.discoverer, session.advertiser, text))
            }
            assertThrows(IllegalArgumentException::class.java) { session.discoverer.channel!!.encodeText("101") }
        }
    }

    @Test fun stalledPeerAndConnectionAttemptLimiterAreBounded() {
        val server = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        val executor = Executors.newSingleThreadExecutor()
        try {
            val waiting = executor.submit<Boolean> {
                server.accept().use { socket ->
                    socket.soTimeout = 100
                    try {
                        LocalSessionProtocol.readFrame(BufferedInputStream(socket.getInputStream()))
                        false
                    } catch (_: SocketTimeoutException) { true }
                }
            }
            Socket(InetAddress.getLoopbackAddress(), server.localPort).use { assertTrue(waiting.get(2, TimeUnit.SECONDS)) }
        } finally {
            server.close()
            executor.shutdownNow()
        }

        val limiter = ConnectionAttemptLimiter()
        repeat(6) { assertTrue(limiter.reserve(it.toLong())) }
        assertFalse(limiter.reserve(6))
        assertTrue(limiter.reserve(60_000)) // attempt at t=0 expired; t=1..5 remain in-window
        assertFalse(limiter.reserve(60_000))
        assertTrue(limiter.reserve(60_001)) // attempt at t=1 expired
        assertFalse(limiter.reserve(60_001))
    }

    @Test fun maximumTextFrameQueueAndTypeBoundsAreEnforced() {
        val code = LocalSessionCrypto.generatePairingCode(SecureRandom())
        LoopbackSession(code).use { session ->
            session.assertBothSecure()
            val maxText = "x".repeat(LocalSessionProtocol.maxText)
            assertEquals(maxText, session.sendText(session.discoverer, session.advertiser, maxText))
            assertThrows(IllegalArgumentException::class.java) {
                session.discoverer.channel!!.encodeText("x".repeat(LocalSessionProtocol.maxText + 1))
            }
        }
        assertEquals(512, LocalSessionProtocol.encodeFrame(LocalSessionProtocol.TYPE_SECURE_TEXT, ByteArray(LocalSessionProtocol.maxPayload - 1)).size)
        assertThrows(IllegalArgumentException::class.java) {
            LocalSessionProtocol.encodeFrame(LocalSessionProtocol.TYPE_SECURE_TEXT, ByteArray(LocalSessionProtocol.maxPayload))
        }
        assertThrows(IllegalArgumentException::class.java) {
            LocalSessionProtocol.decodeSecureText(LocalSessionProtocol.Frame(99, ByteArray(24)))
        }
        val queue = OutboundFrameQueue(maxFrames = 1, maxBytes = 8)
        assertTrue(queue.offer(ByteArray(8)))
        assertFalse(queue.offer(byteArrayOf(1)))
    }

    private enum class Tamper { CIPHERTEXT, TAG }
    private enum class Peer { ADVERTISER, DISCOVERER }
    private data class WireKey(val peer: Peer, val type: Byte)

    private data class LinkFault(
        val drop: Set<WireKey> = emptySet(),
        val tamper: Set<WireKey> = emptySet(),
        val replay: Map<WireKey, ByteArray> = emptyMap(),
        val closeAfter: Set<WireKey> = emptySet(),
    )

    private class LoopbackLink(private val fault: LinkFault) {
        private val captured = java.util.concurrent.ConcurrentHashMap<WireKey, ByteArray>()

        fun write(peer: Peer, socket: Socket, output: BufferedOutputStream, encoded: ByteArray) {
            val original = LocalSessionProtocol.readFrame(ByteArrayInputStream(encoded))
            val key = WireKey(peer, original.type)
            captured[key] = encoded.copyOf()
            if (key in fault.drop) return // model a successful local write followed by network loss
            var outgoing = fault.replay[key]?.copyOf() ?: encoded.copyOf()
            if (key in fault.tamper) {
                val parsed = LocalSessionProtocol.readFrame(ByteArrayInputStream(outgoing))
                val altered = parsed.body.copyOf()
                if (altered.isEmpty()) {
                    outgoing = LocalSessionProtocol.encodeFrame((parsed.type.toInt() xor 1).toByte(), altered)
                } else {
                    altered[altered.lastIndex] = (altered.last().toInt() xor 1).toByte()
                    outgoing = LocalSessionProtocol.encodeFrame(parsed.type, altered)
                }
            }
            output.write(outgoing)
            output.flush()
            if (key in fault.closeAfter) socket.close()
        }

        fun wasWritten(peer: Peer, type: Byte) = captured.containsKey(WireKey(peer, type))
        fun capturedFrames(): Map<WireKey, ByteArray> = captured.mapValues { it.value.copyOf() }
    }

    private data class Endpoint(
        val peer: Peer,
        val state: ExperimentState,
        var generation: Int,
        var handshake: LocalSessionHandshake? = null,
        var channel: LocalSessionSecureChannel? = null,
        var socket: Socket? = null,
        var input: BufferedInputStream? = null,
        var output: BufferedOutputStream? = null,
        var failure: String? = null,
    ) {
        val secureConnected get() = state.value.secureConnected && channel?.active == true

        fun clear(reason: SafeReason = SafeReason.PEER_DISCONNECTED) {
            runCatching { socket?.close() }
            channel?.close()
            if (state.value.generation == generation && state.value.stage == Stage.CONNECTED) {
                state.transition(generation, Stage.DISCONNECTED, "Loopback transport closed", reason)
                state.clearTemporaryData(generation)
            }
        }
    }

    private class LoopbackSession(
        val advertiserCode: String,
        val discovererCode: String = advertiserCode,
        fault: LinkFault = LinkFault(),
        private val acceptanceWaitMs: Long? = null,
    ) : AutoCloseable {
        val link = LoopbackLink(fault)
        val advertiser = Endpoint(Peer.ADVERTISER, ExperimentState(), 0)
        val discoverer = Endpoint(Peer.DISCOVERER, ExperimentState(), 0)
        private val hostContext = ByteArray(16).also(SecureRandom()::nextBytes)
        private val listener = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        private val executor = Executors.newSingleThreadExecutor()

        init {
            advertiser.generation = advertiser.state.begin("advertiser")
            advertiser.state.setPairingCode(advertiser.generation, LocalSessionCrypto.formatPairingCode(advertiserCode))
            discoverer.generation = discoverer.state.begin("discoverer")
            discoverer.state.transition(discoverer.generation, Stage.PEER_FOUND, "Found loopback service")
            discoverer.state.transition(discoverer.generation, Stage.CONNECTING, "Connecting to loopback service")
            val serverFuture = executor.submit { runAdvertiser() }
            val clientSocket = Socket()
            clientSocket.connect(java.net.InetSocketAddress(InetAddress.getLoopbackAddress(), listener.localPort), 1_000)
            clientSocket.tcpNoDelay = true
            clientSocket.soTimeout = SOCKET_TIMEOUT_MS
            discoverer.socket = clientSocket
            discoverer.input = BufferedInputStream(clientSocket.getInputStream())
            discoverer.output = BufferedOutputStream(clientSocket.getOutputStream())
            runDiscoverer()
            serverFuture.get(2, TimeUnit.SECONDS)
        }

        fun assertBothSecure() {
            assertTrue("advertiser stage=${advertiser.state.value.stage} failure=${advertiser.failure}", advertiser.secureConnected)
            assertTrue("discoverer stage=${discoverer.state.value.stage} failure=${discoverer.failure}", discoverer.secureConnected)
            assertEquals(LocalSessionHandshake.Phase.CONNECTED, advertiser.handshake?.phase)
            assertEquals(LocalSessionHandshake.Phase.CONNECTED, discoverer.handshake?.phase)
        }

        fun sendText(sender: Endpoint, receiver: Endpoint, text: String): String {
            val encoded = sender.channel!!.encodeText(text)
            link.write(sender.peer, sender.socket!!, sender.output!!, encoded)
            return receiver.channel!!.decodeText(LocalSessionProtocol.readFrame(receiver.input!!))
        }

        fun receiveEncoded(receiver: Endpoint, encoded: ByteArray): String =
            receiver.channel!!.decodeText(LocalSessionProtocol.readFrame(ByteArrayInputStream(encoded)))

        fun observePeerDisconnect(endpoint: Endpoint) {
            try {
                LocalSessionProtocol.readFrame(endpoint.input ?: throw IOException("PEER_DISCONNECTED"))
                fail("expected peer close")
            } catch (_: IOException) {
                endpoint.clear()
            }
        }

        fun closeBoth() {
            advertiser.clear()
            discoverer.clear()
        }

        override fun close() {
            closeBoth()
            runCatching { listener.close() }
            executor.shutdownNow()
        }

        private fun runAdvertiser() {
            val endpoint = advertiser
            val socket = try { listener.accept() } catch (error: Throwable) { failEndpoint(endpoint, error); return }
            endpoint.socket = socket
            socket.soTimeout = SOCKET_TIMEOUT_MS
            endpoint.input = BufferedInputStream(socket.getInputStream())
            endpoint.output = BufferedOutputStream(socket.getOutputStream())
            try {
                LocalSessionProtocol.readPreamble(endpoint.input!!)
                val handshake = LocalSessionHandshake.advertiser(hostContext, advertiserCode, SecureRandom())
                endpoint.handshake = handshake
                val challenge = handshake.advertiserOnHello(LocalSessionProtocol.readFrame(endpoint.input!!))
                endpoint.state.transition(endpoint.generation, Stage.AUTHENTICATING, "Authenticating pairing code")
                link.write(Peer.ADVERTISER, socket, endpoint.output!!, challenge)
                handshake.advertiserOnAuth(LocalSessionProtocol.readFrame(endpoint.input!!))
                endpoint.state.transition(endpoint.generation, Stage.WAITING_ACCEPTANCE, "Waiting for explicit acceptance")
                if (acceptanceWaitMs != null && !CountDownLatch(1).await(acceptanceWaitMs, TimeUnit.MILLISECONDS)) {
                    throw IOException("ACCEPT_TIMEOUT")
                }
                endpoint.state.transition(endpoint.generation, Stage.CONNECTING, "ACCEPT sent; waiting for discoverer READY")
                link.write(Peer.ADVERTISER, socket, endpoint.output!!, handshake.advertiserAccept())
                val readyAck = handshake.advertiserOnReady(LocalSessionProtocol.readFrame(endpoint.input!!))
                link.write(Peer.ADVERTISER, socket, endpoint.output!!, readyAck)
                endpoint.channel = LocalSessionSecureChannel(handshake.advertiserReadyAckWritten(), handshake.role)
                endpoint.state.updateSecurity(endpoint.generation, "pairing code verified", "AES-256-GCM active", true, true)
                endpoint.state.setPairingCode(endpoint.generation, null)
                endpoint.state.transition(endpoint.generation, Stage.CONNECTED, "Encrypted loopback session connected")
            } catch (error: Throwable) {
                failEndpoint(endpoint, error)
            }
        }

        private fun runDiscoverer() {
            val endpoint = discoverer
            try {
                LocalSessionProtocol.writePreamble(endpoint.output!!)
                val handshake = LocalSessionHandshake.discoverer(hostContext, discovererCode, SecureRandom())
                endpoint.handshake = handshake
                link.write(Peer.DISCOVERER, endpoint.socket!!, endpoint.output!!, handshake.discovererStart())
                val auth = handshake.discovererOnChallenge(LocalSessionProtocol.readFrame(endpoint.input!!))
                endpoint.state.transition(endpoint.generation, Stage.AUTHENTICATING, "Authenticating pairing code")
                link.write(Peer.DISCOVERER, endpoint.socket!!, endpoint.output!!, auth)
                val ready = handshake.discovererOnAccept(LocalSessionProtocol.readFrame(endpoint.input!!))
                endpoint.state.annotate(endpoint.generation, "READY sent; waiting for advertiser READY_ACK")
                link.write(Peer.DISCOVERER, endpoint.socket!!, endpoint.output!!, ready)
                endpoint.channel = LocalSessionSecureChannel(
                    handshake.discovererOnReadyAck(LocalSessionProtocol.readFrame(endpoint.input!!)), handshake.role
                )
                endpoint.state.updateSecurity(endpoint.generation, "pairing code verified", "AES-256-GCM active", true, true)
                endpoint.state.setPairingCode(endpoint.generation, null)
                endpoint.state.transition(endpoint.generation, Stage.CONNECTED, "Encrypted loopback session connected")
            } catch (error: Throwable) {
                failEndpoint(endpoint, error)
            }
        }

        private fun failEndpoint(endpoint: Endpoint, error: Throwable) {
            endpoint.failure = error.message ?: error.javaClass.simpleName
            endpoint.handshake?.abort()
            endpoint.channel?.close()
            endpoint.state.transition(endpoint.generation, Stage.FAILED, "Loopback handshake failed", SafeReason.PAIRING_AUTH_FAILED)
            endpoint.state.clearTemporaryData(endpoint.generation)
            runCatching { endpoint.socket?.close() }
        }

        companion object {
            private const val SOCKET_TIMEOUT_MS = 350
        }
    }

    private fun differentCode(code: String): String = (if (code[0] == '0') "1" else "0") + code.substring(1)
}
