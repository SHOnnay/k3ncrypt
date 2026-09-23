package com.k3ncrypt.messaging

import com.k3ncrypt.crypto.AccountHandle
import com.k3ncrypt.crypto.CryptoPort
import com.k3ncrypt.crypto.SessionHandle
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.SessionState
import java.security.MessageDigest

data class MailboxDelivery(val id: String, val senderRoutingId: String, val envelope: String)
data class SenderBundle(val senderIdentityKey: String)
data class PersistedMessage(val deliveryId: String, val text: String)

interface SenderBundleResolver { suspend fun resolve(senderRoutingId: String): SenderBundle }
interface DeviceTrustVerifier { suspend fun requireTrustedSender(senderRoutingId: String, senderIdentityKey: String) }
interface ConversationSessionStore { suspend fun existing(senderRoutingId: String): SessionHandle?; suspend fun remember(senderRoutingId: String, session: SessionHandle) }
interface MessageStore { suspend fun contains(digest: String): Boolean; suspend fun insert(digest: String, message: PersistedMessage) }
interface PickleKeyProvider { fun currentPickleKey(): ByteArray }

sealed interface DeliveryAcceptance { data object Accepted : DeliveryAcceptance; data object Duplicate : DeliveryAcceptance; data class Rejected(val category: String) : DeliveryAcceptance }

/** Accepts a mailbox item only after cryptographic and durable state commit succeeds. */
class InboundMessageProcessor(
    private val account: AccountHandle,
    private val accountId: String,
    private val crypto: CryptoPort,
    private val cryptoState: CryptoStateStore,
    private val bundles: SenderBundleResolver,
    private val trust: DeviceTrustVerifier,
    private val sessions: ConversationSessionStore,
    private val messages: MessageStore,
    private val pickleKeys: PickleKeyProvider,
) {
    suspend fun receive(delivery: MailboxDelivery): DeliveryAcceptance {
        return try {
            val envelope = EncryptedEnvelopeParser.parse(delivery.envelope)
            val digest = MessageDigest.getInstance("SHA-256").digest(delivery.envelope.encodeToByteArray()).joinToString("") { "%02x".format(it) }
            if (messages.contains(digest)) {
                DeliveryAcceptance.Duplicate
            } else {
                val bundle = bundles.resolve(delivery.senderRoutingId)
                trust.requireTrustedSender(delivery.senderRoutingId, bundle.senderIdentityKey)
                val existing = sessions.existing(delivery.senderRoutingId)
                val plaintext = if (existing == null) {
                    val inbound = crypto.establishInboundSession(account, bundle.senderIdentityKey, envelope.olmMessage)
                    persistThenRememberSession(
                        persist = { persist(inbound.session) },
                        remember = { sessions.remember(delivery.senderRoutingId, inbound.session) },
                    )
                    inbound.plaintext
                } else {
                    val value = crypto.decrypt(existing, envelope.olmMessage)
                    persist(existing)
                    value
                }
                require(plaintext.size >= 2 && plaintext[0] == 1.toByte() && plaintext[1] == 1.toByte()) { "Invalid message frame" }
                messages.insert(digest, PersistedMessage(delivery.id, plaintext.copyOfRange(2, plaintext.size).decodeToString()))
                DeliveryAcceptance.Accepted
            }
        } catch (_: IllegalArgumentException) { DeliveryAcceptance.Rejected("invalid-envelope")
        } catch (_: SecurityException) { DeliveryAcceptance.Rejected("identity-or-trust")
        } catch (_: Exception) { DeliveryAcceptance.Rejected("runtime-or-persistence") }
    }

    private suspend fun persist(session: SessionHandle) {
        val pickleKey = pickleKeys.currentPickleKey()
        try { cryptoState.commitAccountAndSession(accountId, crypto.saveAccount(account, pickleKey), SessionState(session.value.toString(), crypto.saveSession(session))) }
        finally { pickleKey.fill(0) }
    }
}

/** Keeps an uncommitted inbound session out of the active session map. */
internal suspend fun persistThenRememberSession(persist: suspend () -> Unit, remember: suspend () -> Unit) {
    persist()
    remember()
}
