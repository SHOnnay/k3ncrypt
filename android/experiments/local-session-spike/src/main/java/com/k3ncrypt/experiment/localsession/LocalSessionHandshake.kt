package com.k3ncrypt.experiment.localsession

import java.security.SecureRandom

/** Protocol state machine shared by the Android controller and loopback integration tests. */
internal class LocalSessionHandshake private constructor(
    val role: Role,
    hostContext: ByteArray,
    pairingCode: String,
    private val random: SecureRandom,
) {
    enum class Role { DISCOVERER, ADVERTISER }
    enum class Phase {
        NEW, WAITING_FOR_HELLO, WAITING_FOR_CHALLENGE, WAITING_FOR_AUTH,
        WAITING_FOR_ACCEPTANCE, WAITING_FOR_ACCEPT, WAITING_FOR_READY,
        WAITING_FOR_READY_ACK, READY_ACK_PENDING_WRITE, CONNECTED, FAILED, CLOSED
    }

    private val hostContext = hostContext.copyOf()
    private var pairingCode: String? = LocalSessionCrypto.normalizePairingCode(pairingCode)
    private var clientContext: ByteArray? = null
    private var clientNonce: ByteArray? = null
    private var serverNonce: ByteArray? = null
    private var keys: LocalSessionCrypto.KeySet? = null

    var phase: Phase = if (role == Role.ADVERTISER) Phase.WAITING_FOR_HELLO else Phase.NEW
        private set

    init { require(hostContext.size == 16) { "CONTEXT_MISMATCH" } }

    fun discovererStart(): ByteArray = step(Role.DISCOVERER, Phase.NEW) {
        clientContext = ByteArray(16).also(random::nextBytes)
        clientNonce = ByteArray(16).also(random::nextBytes)
        phase = Phase.WAITING_FOR_CHALLENGE
        LocalSessionProtocol.hello(hostContext, clientContext!!, clientNonce!!)
    }

    fun advertiserOnHello(frame: LocalSessionProtocol.Frame): ByteArray = step(Role.ADVERTISER, Phase.WAITING_FOR_HELLO) {
        val hello = LocalSessionProtocol.decodeHello(frame, hostContext)
        clientContext = hello.clientContext
        clientNonce = hello.clientNonce
        serverNonce = ByteArray(16).also(random::nextBytes)
        val transcript = LocalSessionCrypto.transcript(hostContext, clientContext!!, clientNonce!!, serverNonce!!)
        deriveKeys(transcript)
        phase = Phase.WAITING_FOR_AUTH
        LocalSessionProtocol.challenge(hostContext, clientContext!!, clientNonce!!, serverNonce!!)
    }

    fun discovererOnChallenge(frame: LocalSessionProtocol.Frame): ByteArray = step(Role.DISCOVERER, Phase.WAITING_FOR_CHALLENGE) {
        val challenge = LocalSessionProtocol.decodeChallenge(
            frame, hostContext, clientContext ?: error("CONTEXT_MISMATCH"), clientNonce ?: error("CONTEXT_MISMATCH")
        )
        serverNonce = challenge.serverNonce
        val transcript = LocalSessionCrypto.transcript(hostContext, clientContext!!, clientNonce!!, serverNonce!!)
        deriveKeys(transcript)
        phase = Phase.WAITING_FOR_ACCEPT
        val proof = LocalSessionCrypto.clientProof(requireKeys())
        try { LocalSessionProtocol.auth(proof) } finally { proof.fill(0) }
    }

    fun advertiserOnAuth(frame: LocalSessionProtocol.Frame) = step(Role.ADVERTISER, Phase.WAITING_FOR_AUTH) {
        val actual = LocalSessionProtocol.decodeProof(frame, LocalSessionProtocol.TYPE_AUTH)
        val expected = LocalSessionCrypto.clientProof(requireKeys())
        val valid = try { LocalSessionCrypto.verifyProof(expected, actual) }
        finally { expected.fill(0); actual.fill(0) }
        require(valid) { "PAIRING_AUTH_FAILED" }
        phase = Phase.WAITING_FOR_ACCEPTANCE
    }

    /** Call only after the advertiser's explicit user acceptance. */
    fun advertiserAccept(): ByteArray = step(Role.ADVERTISER, Phase.WAITING_FOR_ACCEPTANCE) {
        phase = Phase.WAITING_FOR_READY
        val proof = LocalSessionCrypto.serverProof(requireKeys())
        try { LocalSessionProtocol.accept(proof) } finally { proof.fill(0) }
    }

    fun discovererOnAccept(frame: LocalSessionProtocol.Frame): ByteArray = step(Role.DISCOVERER, Phase.WAITING_FOR_ACCEPT) {
        val actual = LocalSessionProtocol.decodeProof(frame, LocalSessionProtocol.TYPE_ACCEPT)
        val expected = LocalSessionCrypto.serverProof(requireKeys())
        val valid = try { LocalSessionCrypto.verifyProof(expected, actual) }
        finally { expected.fill(0); actual.fill(0) }
        require(valid) { "PAIRING_AUTH_FAILED" }
        phase = Phase.WAITING_FOR_READY_ACK
        val proof = LocalSessionCrypto.clientReadyProof(requireKeys())
        try { LocalSessionProtocol.ready(proof) } finally { proof.fill(0) }
    }

    fun advertiserOnReady(frame: LocalSessionProtocol.Frame): ByteArray = step(Role.ADVERTISER, Phase.WAITING_FOR_READY) {
        val actual = LocalSessionProtocol.decodeProof(frame, LocalSessionProtocol.TYPE_READY)
        val expected = LocalSessionCrypto.clientReadyProof(requireKeys())
        val valid = try { LocalSessionCrypto.verifyProof(expected, actual) }
        finally { expected.fill(0); actual.fill(0) }
        require(valid) { "PAIRING_AUTH_FAILED" }
        phase = Phase.READY_ACK_PENDING_WRITE
        val proof = LocalSessionCrypto.serverReadyProof(requireKeys())
        try { LocalSessionProtocol.readyAck(proof) } finally { proof.fill(0) }
    }

    /** The advertiser establishes its local side only after its READY_ACK write succeeds. */
    fun advertiserReadyAckWritten(): LocalSessionCrypto.KeySet = step(Role.ADVERTISER, Phase.READY_ACK_PENDING_WRITE) {
        phase = Phase.CONNECTED
        takeKeys()
    }

    fun discovererOnReadyAck(frame: LocalSessionProtocol.Frame): LocalSessionCrypto.KeySet = step(Role.DISCOVERER, Phase.WAITING_FOR_READY_ACK) {
        val actual = LocalSessionProtocol.decodeProof(frame, LocalSessionProtocol.TYPE_READY_ACK)
        val expected = LocalSessionCrypto.serverReadyProof(requireKeys())
        val valid = try { LocalSessionCrypto.verifyProof(expected, actual) }
        finally { expected.fill(0); actual.fill(0) }
        require(valid) { "PAIRING_AUTH_FAILED" }
        phase = Phase.CONNECTED
        takeKeys()
    }

    fun abort() {
        if (phase == Phase.CONNECTED || phase == Phase.CLOSED) return
        phase = Phase.FAILED
        clearHandshakeMaterial(clearKeys = true)
    }

    fun close() {
        if (phase != Phase.CONNECTED) abort()
        phase = Phase.CLOSED
        clearHandshakeMaterial(clearKeys = true)
    }

    private fun deriveKeys(transcript: ByteArray) {
        try {
            keys = LocalSessionCrypto.derive(pairingCode ?: error("PAIRING_AUTH_FAILED"), transcript)
        } finally {
            transcript.fill(0)
            pairingCode = null
        }
    }

    private fun requireKeys() = keys ?: error("CRYPTO_FAILED")

    private fun takeKeys(): LocalSessionCrypto.KeySet {
        val result = requireKeys()
        keys = null
        clearHandshakeMaterial(clearKeys = false)
        return result
    }

    private fun clearHandshakeMaterial(clearKeys: Boolean) {
        if (clearKeys) keys?.clear()
        if (clearKeys) keys = null
        hostContext.fill(0)
        clientContext?.fill(0); clientContext = null
        clientNonce?.fill(0); clientNonce = null
        serverNonce?.fill(0); serverNonce = null
        pairingCode = null
    }

    private inline fun <T> step(role: Role, expected: Phase, block: () -> T): T {
        try {
            check(this.role == role && phase == expected) { "UNEXPECTED_MESSAGE" }
            return block()
        } catch (error: Exception) {
            abort()
            throw error
        }
    }

    companion object {
        fun advertiser(hostContext: ByteArray, pairingCode: String, random: SecureRandom) =
            LocalSessionHandshake(Role.ADVERTISER, hostContext, pairingCode, random)

        fun discoverer(hostContext: ByteArray, pairingCode: String, random: SecureRandom) =
            LocalSessionHandshake(Role.DISCOVERER, hostContext, pairingCode, random)
    }
}

/** Authenticated synthetic-text channel shared by production and loopback tests. */
internal class LocalSessionSecureChannel(
    keys: LocalSessionCrypto.KeySet,
    private val role: LocalSessionHandshake.Role,
) : AutoCloseable {
    private var keys: LocalSessionCrypto.KeySet? = keys
    private var sendSequence = 1L
    private var receiveSequence = 1L

    val active: Boolean get() = keys != null

    fun encodeText(value: String): ByteArray {
        val current = keys ?: error("CRYPTO_FAILED")
        val plaintext = LocalSessionProtocol.validateSyntheticText(value)
        val clientToServer = role == LocalSessionHandshake.Role.DISCOVERER
        val key = if (clientToServer) current.clientToServerKey else current.serverToClientKey
        val prefix = if (clientToServer) current.clientNoncePrefix else current.serverNoncePrefix
        val direction: Byte = if (clientToServer) 1 else 2
        val ciphertext = try {
            LocalSessionCrypto.encryptText(key, prefix, current.transcriptHash, direction, sendSequence, plaintext)
        } finally { plaintext.fill(0) }
        return try { LocalSessionProtocol.secureText(sendSequence, ciphertext).also { sendSequence++ } }
        finally { ciphertext.fill(0) }
    }

    fun decodeText(frame: LocalSessionProtocol.Frame): String {
        val current = keys ?: error("CRYPTO_FAILED")
        val secure = LocalSessionProtocol.decodeSecureText(frame)
        LocalSessionProtocol.requireExpectedSequence(secure.sequence, receiveSequence)
        val clientToServer = role == LocalSessionHandshake.Role.ADVERTISER
        val key = if (clientToServer) current.clientToServerKey else current.serverToClientKey
        val prefix = if (clientToServer) current.clientNoncePrefix else current.serverNoncePrefix
        val direction: Byte = if (clientToServer) 1 else 2
        val plaintext = try {
            LocalSessionCrypto.decryptText(key, prefix, current.transcriptHash, direction, receiveSequence, secure.ciphertext)
        } finally { secure.ciphertext.fill(0) }
        return try { LocalSessionProtocol.decodeSyntheticText(plaintext).also { receiveSequence++ } }
        finally { plaintext.fill(0) }
    }

    override fun close() {
        keys?.clear()
        keys = null
    }
}
