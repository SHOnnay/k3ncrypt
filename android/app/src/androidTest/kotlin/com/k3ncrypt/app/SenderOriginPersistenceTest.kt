package com.k3ncrypt.app

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.K3ncryptSecureDatabase
import com.k3ncrypt.storage.KeystoreAead
import com.k3ncrypt.storage.LocalVaultGate
import com.k3ncrypt.storage.SessionState
import com.k3ncrypt.storage.StoredOutboundMessage
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SenderOriginPersistenceTest {
    @Test
    fun outboundRoomTransactionRollsBackAndRestoresExactOriginRecordAfterRestart() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "sender-origin-${UUID.randomUUID()}.db"
        val aead = KeystoreAead()
        var database = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, databaseName).build()
        LocalVaultGate(database, aead).openAfterSystemAuthentication()
        var state = CryptoStateStore(database, aead)
        val message = StoredOutboundMessage("client-1", "conversation-1", "sender-route", "peer-route", "persisted text", 1L)
        val exactEnvelope = "{\"version\":2,\"strategy\":\"vodozemac-olm-v1\",\"data\":{\"olmMessage\":\"opaque-exact-ciphertext\"}}"
        try {
            state.commitAccountAndSession("account-1", "old-account", SessionState("peer-route", byteArrayOf(1, 2)))
            database.openHelper.writableDatabase.execSQL(
                "CREATE TRIGGER abort_sender_history BEFORE INSERT ON secure_records " +
                    "WHEN NEW.namespace = 'outbound-message' BEGIN SELECT RAISE(ABORT, 'simulated transaction abort'); END",
            )
            val aborted = runCatching {
                state.commitOutbound("account-1", "new-account", SessionState("peer-route", byteArrayOf(3, 4)), "client-1", exactEnvelope, message)
            }
            assertTrue("Room should abort the sender transaction at the history write", aborted.isFailure)
            assertEquals("old-account", state.read("account", "account-1")?.decodeToString())
            assertArrayEquals(byteArrayOf(1, 2), state.read("session", "peer-route"))
            assertTrue(state.pendingOutbox().isEmpty())
            assertTrue(state.messages().isEmpty())

            database.openHelper.writableDatabase.execSQL("DROP TRIGGER abort_sender_history")
            state.commitOutbound("account-1", "new-account", SessionState("peer-route", byteArrayOf(3, 4)), "client-1", exactEnvelope, message)
            val stored = JSONObject(state.pendingOutbox().single().second)
            assertEquals(exactEnvelope, stored.getString("envelope"))
            assertEquals(1, stored.getJSONObject("senderOrigin").getInt("version"))
            assertEquals("durable-commit", stored.getJSONObject("senderOrigin").getString("basis"))
            assertEquals("persisted text", state.messages().single().text)
            database.close()

            database = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, databaseName).build()
            LocalVaultGate(database, aead).openAfterSystemAuthentication()
            state = CryptoStateStore(database, aead)
            val restored = JSONObject(state.pendingOutbox().single().second)
            assertEquals(exactEnvelope, restored.getString("envelope"))
            assertEquals(1, restored.getJSONObject("senderOrigin").getInt("version"))
            assertEquals("durable-commit", restored.getJSONObject("senderOrigin").getString("basis"))
            assertArrayEquals(byteArrayOf(3, 4), state.read("session", "peer-route"))
            assertEquals("new-account", state.read("account", "account-1")?.decodeToString())
            assertEquals("persisted text", state.messages().single().text)
            // Older retry readers can ignore the additive field and still use the unchanged envelope key.
            assertEquals(exactEnvelope, restored.getString("envelope"))
        } finally {
            database.close()
            context.deleteDatabase(databaseName)
        }
    }
}
