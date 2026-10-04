package com.k3ncrypt.messaging

import com.k3ncrypt.crypto.AccountHandle
import com.k3ncrypt.crypto.CryptoPort
import com.k3ncrypt.crypto.InboundSession
import com.k3ncrypt.crypto.PublicIdentity
import com.k3ncrypt.crypto.SessionHandle
import com.k3ncrypt.storage.InboundAcceptanceStore
import com.k3ncrypt.storage.InboundCommitResult
import com.k3ncrypt.storage.SessionState
import com.k3ncrypt.storage.StoredMessage
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger

class InboundMessageProcessorTest {
    private val conversation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    private val route = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    private val wire = "{\"version\":1,\"message_type\":1,\"ciphertext\":\"opaque\"}"
    private val compact = "{\"version\":2,\"strategy\":\"vodozemac-olm-v1\",\"data\":{\"version\":1,\"olmMessage\":${org.json.JSONObject.quote(wire)}}}"
    private val reformatted = "{ \"data\" : { \"olmMessage\" : ${org.json.JSONObject.quote(wire)}, \"version\" : 1 }, \"strategy\" : \"vodozemac-olm-v1\", \"version\" : 2 }"

    @Test fun `M1 duplicate is rejected before decrypt across formatting and processor restart`() = runBlocking {
        val store = MemoryStore()
        val crypto = FakeCrypto()
        val accepted = processor(store, crypto).receive(MailboxDelivery("relay-1", route, compact, conversation))
        assertEquals(DeliveryAcceptance.Accepted, accepted)
        assertEquals(1, crypto.decryptCalls.get())
        assertEquals(1, store.messages.size)
        assertEquals(setOf(digest(compact)), store.digests)
        assertEquals(setOf(EnvelopeIdentity.create(conversation, wire)), store.envelopeIds)

        // A new processor models process restart; the durable M1 marker remains.
        val restarted = processor(store, crypto).receive(MailboxDelivery("relay-2", route, reformatted, conversation))
        assertEquals(DeliveryAcceptance.Duplicate, restarted)
        assertEquals(1, crypto.decryptCalls.get())
        assertEquals(1, store.messages.size)
    }

    @Test fun `legacy-only replay marker still suppresses before decrypt`() = runBlocking {
        val store = MemoryStore()
        store.digests += digest(compact)
        val crypto = FakeCrypto()

        assertEquals(DeliveryAcceptance.Duplicate,
            processor(store, crypto).receive(MailboxDelivery("relay-legacy", route, compact, conversation)))
        assertEquals(0, crypto.decryptCalls.get())
        assertTrue(store.envelopeIds.isEmpty())
        assertTrue(store.messages.isEmpty())
    }

    @Test fun `aborted durable acceptance leaves no partial state and redelivery recovers`() = runBlocking {
        val store = MemoryStore().apply { failNextCommit = true }
        val crypto = FakeCrypto()
        val invalidations = AtomicInteger()
        val first = processor(store, crypto, invalidations)

        assertEquals(DeliveryAcceptance.Rejected("runtime-or-persistence"),
            first.receive(MailboxDelivery("relay-1", route, compact, conversation)))
        assertEquals(1, crypto.decryptCalls.get())
        assertEquals(1, invalidations.get())
        assertTrue(store.digests.isEmpty())
        assertTrue(store.envelopeIds.isEmpty())
        assertTrue(store.messages.isEmpty())

        // The redelivered copy is processed by a restored processor against unchanged durable state.
        assertEquals(DeliveryAcceptance.Accepted,
            processor(store, crypto).receive(MailboxDelivery("relay-2", route, compact, conversation)))
        assertEquals(2, crypto.decryptCalls.get())
        assertEquals(1, store.messages.size)
        assertEquals(setOf(EnvelopeIdentity.create(conversation, wire)), store.envelopeIds)
    }

    @Test fun `concurrent relay copies can commit only one message`() = runBlocking {
        val store = MemoryStore()
        val crypto = FakeCrypto()
        val arrivals = AtomicInteger()
        val bothAtCommit = CompletableDeferred<Unit>()
        store.beforeCommit = {
            if (arrivals.incrementAndGet() == 2) bothAtCommit.complete(Unit)
            bothAtCommit.await()
        }
        val left = processor(store, crypto)
        val right = processor(store, crypto)

        val results = listOf(
            async { left.receive(MailboxDelivery("relay-a", route, compact, conversation)) },
            async { right.receive(MailboxDelivery("relay-b", route, reformatted, conversation)) },
        ).awaitAll()
        assertEquals(setOf(DeliveryAcceptance.Accepted, DeliveryAcceptance.Duplicate), results.toSet())
        assertEquals(1, store.messages.size)
        assertEquals(1, store.envelopeIds.size)
    }

    @Test fun `prekey first receive and subsequent duplicate use the same durable M1 key`() = runBlocking {
        val firstWire = "{\"version\":1,\"message_type\":0,\"ciphertext\":\"prekey\"}"
        val firstEnvelope = "{\"version\":2,\"strategy\":\"vodozemac-olm-v1\",\"data\":{\"version\":1,\"olmMessage\":${org.json.JSONObject.quote(firstWire)}}}"
        val store = MemoryStore()
        val crypto = FakeCrypto()
        val sessionStore = MemorySessions(null)
        val first = processor(store, crypto, sessions = sessionStore)
        assertEquals(DeliveryAcceptance.Accepted,
            first.receive(MailboxDelivery("prekey-delivery", route, firstEnvelope, conversation)))
        assertEquals(1, crypto.establishCalls.get())
        assertEquals(setOf(EnvelopeIdentity.create(conversation, firstWire)), store.envelopeIds)

        assertEquals(DeliveryAcceptance.Duplicate,
            processor(store, crypto).receive(MailboxDelivery("prekey-replay", route, firstEnvelope, conversation)))
        assertEquals(1, crypto.establishCalls.get())
    }

    private fun processor(
        store: MemoryStore,
        crypto: FakeCrypto,
        invalidations: AtomicInteger = AtomicInteger(),
        sessions: MemorySessions = MemorySessions(SessionHandle(9)),
    ) = InboundMessageProcessor(
        AccountHandle(1),
        "account",
        crypto,
        store,
        SenderBundleResolver { SenderBundle("sender-key") },
        DeviceTrustVerifier { _, _ -> },
        sessions,
        PickleKeyProvider { byteArrayOf(1, 2, 3) },
        VolatileCryptoStateInvalidator { invalidations.incrementAndGet() },
        now = { 100L },
    )

    private fun digest(envelope: String): String = MessageDigest.getInstance("SHA-256")
        .digest(envelope.encodeToByteArray()).joinToString("") { "%02x".format(it) }

    private class MemoryStore : InboundAcceptanceStore {
        val digests = mutableSetOf<String>()
        val envelopeIds = mutableSetOf<String>()
        val messages = mutableListOf<StoredMessage>()
        private val mutex = Mutex()
        var failNextCommit = false
        var beforeCommit: suspend () -> Unit = {}

        override suspend fun hasInboundDigest(digest: String) = digest in digests
        override suspend fun hasInboundEnvelopeId(envelopeId: String) = envelopeId in envelopeIds
        override suspend fun isSessionRenewalArmed(peerRoutingId: String) = false

        override suspend fun commitInbound(
            accountId: String,
            accountPickle: String,
            session: SessionState,
            digest: String,
            message: StoredMessage,
            renewalSenderRoute: String?,
            envelopeId: String,
        ): InboundCommitResult {
            beforeCommit()
            return mutex.withLock {
                if (digest in digests || envelopeId in envelopeIds) return@withLock InboundCommitResult.DUPLICATE
                if (failNextCommit) {
                    failNextCommit = false
                    error("simulated Room transaction abort")
                }
                digests += digest
                envelopeIds += envelopeId
                messages += message
                InboundCommitResult.STORED
            }
        }
    }

    private class MemorySessions(private var session: SessionHandle?) : ConversationSessionStore {
        override suspend fun existing(senderRoutingId: String): SessionHandle? = session
        override suspend fun remember(senderRoutingId: String, session: SessionHandle) { this.session = session }
    }

    private class FakeCrypto : CryptoPort {
        val decryptCalls = AtomicInteger()
        val establishCalls = AtomicInteger()
        override fun createAccount() = AccountHandle(1)
        override fun loadAccount(encryptedPickle: String, pickleKey: ByteArray) = AccountHandle(1)
        override fun saveAccount(account: AccountHandle, pickleKey: ByteArray) = "account-pickle"
        override fun identityKeys(account: AccountHandle) = PublicIdentity("curve-key", "signing-key")
        override fun signControlEvent(account: AccountHandle, canonicalPayload: ByteArray) = "signature"
        override fun generateOneTimeKeys(account: AccountHandle, count: Int) = Unit
        override fun oneTimeKeys(account: AccountHandle) = emptyList<String>()
        override fun generateFallbackKey(account: AccountHandle) = Unit
        override fun fallbackKey(account: AccountHandle) = "fallback"
        override fun markKeysAsPublished(account: AccountHandle) = Unit
        override fun createOutboundSession(account: AccountHandle, recipientIdentityKey: String, recipientPreKey: String) = SessionHandle(9)
        override fun establishInboundSession(account: AccountHandle, senderIdentityKey: String, preKeyMessage: String): InboundSession {
            establishCalls.incrementAndGet()
            return InboundSession(SessionHandle(9), MessageFrame.encodeText("accepted body"))
        }
        override fun encrypt(session: SessionHandle, plaintext: ByteArray) = "wire"
        override fun decrypt(session: SessionHandle, wireMessage: String): ByteArray {
            decryptCalls.incrementAndGet()
            return MessageFrame.encodeText("accepted body")
        }
        override fun saveSession(session: SessionHandle) = byteArrayOf(4, 5, 6)
        override fun loadSession(serialized: ByteArray) = SessionHandle(9)
        override fun closeAccount(account: AccountHandle) = Unit
        override fun closeSession(session: SessionHandle) = Unit
    }
}
