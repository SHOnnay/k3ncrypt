package com.k3ncrypt.app

import android.content.Context
import androidx.room.Room
import androidx.room.withTransaction
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.k3ncrypt.storage.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Real Room/Keystore; synthetic state bytes. Native ratchet coverage is in AndroidCryptoPersistenceInteropTest. */
@RunWith(AndroidJUnit4::class)
class Stage0StorageBoundaryTest {
    @Test fun rollbackRestartRetryAndDuplicateAcceptance() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "stage0-${UUID.randomUUID()}.db"
        var db = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, name).build()
        val aead = KeystoreAead()
        try {
            LocalVaultGate(db, aead).openAfterSystemAuthentication()
            var store = CryptoStateStore(db, aead)
            store.commitAccountAndSession("account", "before", SessionState("session", byteArrayOf(1)))
            var aborted = false
            try {
                db.withTransaction {
                    store.commitOutbound("account", "after", SessionState("session", byteArrayOf(2)), "message", "synthetic-envelope",
                        StoredOutboundMessage("message", "room", "local", "peer", "test", 1))
                    error("injected crash before outer commit")
                }
            } catch (_: IllegalStateException) { aborted = true }
            assertTrue(aborted)
            db.close()
            db = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, name).build()
            store = CryptoStateStore(db, aead)
            assertEquals("before", store.read("account", "account")!!.decodeToString())
            assertArrayEquals(byteArrayOf(1), store.read("session", "session"))
            assertTrue(store.pendingOutbox().isEmpty())
            assertTrue(store.messages().isEmpty())
            store.commitOutbound("account", "after", SessionState("session", byteArrayOf(2)), "message", "synthetic-envelope",
                StoredOutboundMessage("message", "room", "local", "peer", "test", 1))
            val pending = store.pendingOutbox()
            db.close()
            db = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, name).build()
            store = CryptoStateStore(db, aead)
            assertEquals(pending, store.pendingOutbox()) // exact serialized envelope survives repository/storage restart
            store.acknowledgeOutbound("unknown")
            assertEquals(pending, store.pendingOutbox())
            store.acknowledgeOutbound("message"); store.acknowledgeOutbound("message")
            assertTrue(store.pendingOutbox().isEmpty())
            assertEquals(1, store.messages().size) // cleanup is not user-message deletion or peer-persistence proof
            try {
                db.withTransaction {
                    store.commitInbound("account", "received", SessionState("session", byteArrayOf(3)), "digest", StoredMessage("delivery", "room", "peer", "test", 2))
                    error("injected receive interruption")
                }
            } catch (_: IllegalStateException) { /* rollback expected */ }
            assertFalse(store.hasInboundDigest("digest"))
            assertArrayEquals(byteArrayOf(2), store.read("session", "session"))
            assertEquals(InboundCommitResult.STORED, store.commitInbound("account", "received", SessionState("session", byteArrayOf(3)), "digest", StoredMessage("delivery", "room", "peer", "test", 2)))
            assertEquals(InboundCommitResult.DUPLICATE, store.commitInbound("account", "must-not-write", SessionState("session", byteArrayOf(99)), "digest", StoredMessage("other-delivery", "room", "peer", "duplicate", 3)))
            assertArrayEquals(byteArrayOf(3), store.read("session", "session"))
            assertEquals(2, store.messages().size)
        } finally { db.close(); context.deleteDatabase(name) }
    }
}
