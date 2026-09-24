package com.k3ncrypt.messaging

import com.k3ncrypt.crypto.AccountHandle
import com.k3ncrypt.crypto.CryptoPort
import com.k3ncrypt.crypto.SessionHandle
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.InboundCommitResult
import com.k3ncrypt.storage.SessionState
import com.k3ncrypt.storage.StoredMessage
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.security.MessageDigest

data class MailboxDelivery(val id: String, val senderRoutingId: String, val envelope: String, val conversationId: String = "")
data class SenderBundle(val senderIdentityKey: String)

fun interface SenderBundleResolver { suspend fun resolve(senderRoutingId: String): SenderBundle }
fun interface DeviceTrustVerifier { suspend fun requireTrustedSender(senderRoutingId: String, senderIdentityKey: String) }
interface ConversationSessionStore { suspend fun existing(senderRoutingId: String): SessionHandle?; suspend fun remember(senderRoutingId: String, session: SessionHandle) }
fun interface PickleKeyProvider { suspend fun currentPickleKey(): ByteArray }
fun interface VolatileCryptoStateInvalidator { suspend fun invalidateAfterUncommittedMutation() }

sealed interface DeliveryAcceptance { data object Accepted : DeliveryAcceptance; data object Duplicate : DeliveryAcceptance; data class Rejected(val category: String) : DeliveryAcceptance }

/** Validates and decrypts first, atomically commits ratchets + message + dedupe, then publishes a handle. */
class InboundMessageProcessor(
    private val account: AccountHandle,
    private val accountId: String,
    private val crypto: CryptoPort,
    private val cryptoState: CryptoStateStore,
    private val bundles: SenderBundleResolver,
    private val trust: DeviceTrustVerifier,
    private val sessions: ConversationSessionStore,
    private val pickleKeys: PickleKeyProvider,
    private val invalidator: VolatileCryptoStateInvalidator,
    private val diagnosticStage: (String) -> Unit = {},
    private val now: () -> Long = { System.currentTimeMillis() },
) {
    private val mutex = Mutex()

    suspend fun receive(delivery: MailboxDelivery): DeliveryAcceptance = mutex.withLock {
        var cryptoMutated = false
        var inboundSession: SessionHandle? = null
        var plaintext: ByteArray? = null
        try {
            require(delivery.id.isNotBlank() && delivery.senderRoutingId.isNotBlank() && delivery.conversationId.isNotBlank())
            val envelope = EncryptedEnvelopeParser.parse(delivery.envelope)
            val digest = digest(delivery.envelope)
            if (cryptoState.hasInboundDigest(digest)) return@withLock DeliveryAcceptance.Duplicate

            val bundle = bundles.resolve(delivery.senderRoutingId)
            trust.requireTrustedSender(delivery.senderRoutingId, bundle.senderIdentityKey)
            diagnosticStage("trust-check")
            val current = sessions.existing(delivery.senderRoutingId)
            if (current == null) {
                val inbound = crypto.establishInboundSession(account, bundle.senderIdentityKey, envelope.olmMessage)
                diagnosticStage("inbound-session-created")
                cryptoMutated = true
                inboundSession = inbound.session
                plaintext = inbound.plaintext
            } else {
                plaintext = crypto.decrypt(current, envelope.olmMessage)
                cryptoMutated = true
                inboundSession = current
            }

            val body = MessageFrame.decodeText(plaintext!!)
            diagnosticStage("decrypted")
            val pickleKey = pickleKeys.currentPickleKey()
            val outcome = try {
                val accountPickle = crypto.saveAccount(account, pickleKey)
                val sessionPickle = crypto.saveSession(inboundSession!!)
                try {
                    commitAndRememberSession(
                        commit = {
                            cryptoState.commitInbound(
                                accountId,
                                accountPickle,
                                SessionState(delivery.senderRoutingId, sessionPickle),
                                digest,
                                StoredMessage(delivery.id, delivery.conversationId, delivery.senderRoutingId, body, now()),
                            )
                        },
                        remember = { sessions.remember(delivery.senderRoutingId, inboundSession!!) },
                    )
                } finally { sessionPickle.fill(0) }
            } finally { pickleKey.fill(0) }

            if (outcome == InboundCommitResult.DUPLICATE) {
                inboundSession?.let { runCatching { crypto.closeSession(it) } }
                invalidator.invalidateAfterUncommittedMutation()
                return@withLock DeliveryAcceptance.Duplicate
            }
            diagnosticStage("room-commit")
            cryptoMutated = false
            DeliveryAcceptance.Accepted
        } catch (_: IllegalArgumentException) {
            if (cryptoMutated) { inboundSession?.let { runCatching { crypto.closeSession(it) } }; runCatching { invalidator.invalidateAfterUncommittedMutation() } }
            DeliveryAcceptance.Rejected("invalid-envelope")
        } catch (_: SecurityException) {
            if (cryptoMutated) { inboundSession?.let { runCatching { crypto.closeSession(it) } }; runCatching { invalidator.invalidateAfterUncommittedMutation() } }
            DeliveryAcceptance.Rejected("identity-or-trust")
        } catch (_: Exception) {
            if (cryptoMutated) { inboundSession?.let { runCatching { crypto.closeSession(it) } }; runCatching { invalidator.invalidateAfterUncommittedMutation() } }
            DeliveryAcceptance.Rejected("runtime-or-persistence")
        } finally { plaintext?.fill(0) }
    }

    private fun digest(envelope: String): String = MessageDigest.getInstance("SHA-256")
        .digest(envelope.encodeToByteArray()).joinToString("") { "%02x".format(it) }
}

/** Publish a session into the live map only after its account/session/message transaction commits. */
internal suspend fun commitAndRememberSession(
    commit: suspend () -> InboundCommitResult,
    remember: suspend () -> Unit,
): InboundCommitResult {
    val result = commit()
    if (result == InboundCommitResult.STORED) remember()
    return result
}
