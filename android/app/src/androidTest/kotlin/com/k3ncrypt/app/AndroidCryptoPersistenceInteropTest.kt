package com.k3ncrypt.app

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.k3ncrypt.crypto.NativeCryptoBridge
import com.k3ncrypt.messaging.MessageFrame
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.InboundCommitResult
import com.k3ncrypt.storage.K3ncryptSecureDatabase
import com.k3ncrypt.storage.KeystoreAead
import com.k3ncrypt.storage.SessionState
import com.k3ncrypt.storage.StoredMessage
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.MessageDigest
import java.util.UUID

/** Exercises the actual Rust/Vodozemac JNI library and Android persistence primitives on-device. */
@RunWith(AndroidJUnit4::class)
class AndroidCryptoPersistenceInteropTest {
    @Test
    fun olmPreKeyAndRestartedSessionRoundTripWithRoomAndKeystore() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "interop-${UUID.randomUUID()}.db"
        val key = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        val crypto = NativeCryptoBridge()
        val sender = crypto.createAccount()
        val recipient = crypto.createAccount()
        val database = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, databaseName).build()
        val aead = KeystoreAead("k3ncrypt.android.test.${UUID.randomUUID()}")
        val state = CryptoStateStore(database, aead)
        var senderSession: com.k3ncrypt.crypto.SessionHandle? = null
        var inboundSession: com.k3ncrypt.crypto.SessionHandle? = null
        try {
            crypto.generateFallbackKey(recipient)
            val recipientIdentity = crypto.identityKeys(recipient)
            senderSession = crypto.createOutboundSession(sender, recipientIdentity.curve25519, crypto.fallbackKey(recipient))

            val firstFrame = MessageFrame.encodeText("interop-frame-one")
            val firstEnvelope = crypto.encrypt(senderSession, firstFrame)
            val inbound = crypto.establishInboundSession(recipient, crypto.identityKeys(sender).curve25519, firstEnvelope)
            inboundSession = inbound.session
            assertEquals("interop-frame-one", MessageFrame.decodeText(inbound.plaintext))

            val inboundAccountPickle = crypto.saveAccount(recipient, key)
            val inboundSessionPickle = crypto.saveSession(inbound.session)
            val digest = MessageDigest.getInstance("SHA-256").digest(firstEnvelope.encodeToByteArray())
                .joinToString("") { "%02x".format(it) }
            assertEquals(
                InboundCommitResult.STORED,
                state.commitInbound(
                    "interop-account",
                    inboundAccountPickle,
                    SessionState("interop-session", inboundSessionPickle),
                    digest,
                    StoredMessage("delivery-one", "interop-conversation", "sender-route", "interop-frame-one", 1L),
                ),
            )
            assertEquals(InboundCommitResult.DUPLICATE, state.commitInbound(
                "interop-account",
                inboundAccountPickle,
                SessionState("interop-session", inboundSessionPickle),
                digest,
                StoredMessage("delivery-one", "interop-conversation", "sender-route", "interop-frame-one", 1L),
            ))

            // Simulate process death: release native handles and close Room, then reconstruct all state.
            crypto.closeSession(inbound.session)
            inboundSession = null
            crypto.closeAccount(recipient)
            database.close()

            val reopened = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, databaseName).build()
            try {
                val restoredState = CryptoStateStore(reopened, aead)
                val restoredAccountPickle = requireNotNull(restoredState.read("account", "interop-account")).decodeToString()
                val restoredSessionPickle = requireNotNull(restoredState.read("session", "interop-session"))
                val restoredAccount = crypto.loadAccount(restoredAccountPickle, key)
                val restoredSession = crypto.loadSession(restoredSessionPickle)
                try {
                    val secondEnvelope = crypto.encrypt(senderSession, MessageFrame.encodeText("interop-frame-two"))
                    val secondFrame = crypto.decrypt(restoredSession, secondEnvelope)
                    assertEquals("interop-frame-two", MessageFrame.decodeText(secondFrame))
                    assertEquals("interop-frame-one", restoredState.messages().single().text)
                    assertTrue("Encrypted Room record should not contain the marker in plaintext", reopened.records().get("message", "delivery-one")!!.ciphertext.toString(Charsets.ISO_8859_1).let { !it.contains("interop-frame-one") })
                } finally {
                    crypto.closeSession(restoredSession)
                    crypto.closeAccount(restoredAccount)
                }
            } finally {
                reopened.close()
            }
        } finally {
            inboundSession?.let(crypto::closeSession)
            senderSession?.let(crypto::closeSession)
            runCatching { crypto.closeAccount(sender) }
            runCatching { crypto.closeAccount(recipient) }
            database.close()
            context.deleteDatabase(databaseName)
            key.fill(0)
        }
    }
}
