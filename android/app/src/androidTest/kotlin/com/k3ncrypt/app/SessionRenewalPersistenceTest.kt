package com.k3ncrypt.app

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.InboundCommitResult
import com.k3ncrypt.storage.K3ncryptSecureDatabase
import com.k3ncrypt.storage.KeystoreAead
import com.k3ncrypt.storage.SessionState
import com.k3ncrypt.storage.StoredMessage
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SessionRenewalPersistenceTest {
    @Test fun replacementRequiresApprovalAndArchivesPriorSessionAtomically() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.inMemoryDatabaseBuilder(context, K3ncryptSecureDatabase::class.java).build()
        val state = CryptoStateStore(database, KeystoreAead("k3ncrypt.android.renewal.test.${UUID.randomUUID()}"))
        val oldSession = byteArrayOf(1, 2, 3)
        val newSession = byteArrayOf(4, 5, 6)
        try {
            state.commitAccountAndSession("account", "opaque-account", SessionState("peer-route", oldSession))
            val message = StoredMessage("delivery", "conversation", "peer-route", "verified message", 1L)
            assertThrows(IllegalStateException::class.java) {
                runBlocking { state.commitInbound("account", "opaque-account", SessionState("peer-route", newSession), "digest", message, "peer-route") }
            }
            assertArrayEquals(oldSession, state.read("session", "peer-route"))
            assertTrue(state.messages().isEmpty())
            state.armSessionRenewal("peer-route", System.currentTimeMillis() + 60_000)
            assertTrue(state.isSessionRenewalArmed("peer-route"))
            assertEquals(InboundCommitResult.STORED,
                state.commitInbound("account", "opaque-account", SessionState("peer-route", newSession), "digest", message, "peer-route"))
            assertArrayEquals(newSession, state.read("session", "peer-route"))
            assertArrayEquals(oldSession, state.read("session-archive", "peer-route:digest"))
            assertFalse(state.isSessionRenewalArmed("peer-route"))
            assertEquals(1, state.messages().size)
            assertEquals(InboundCommitResult.DUPLICATE,
                state.commitInbound("account", "opaque-account", SessionState("peer-route", newSession), "digest", message, "peer-route"))
        } finally { database.close() }
    }
}
