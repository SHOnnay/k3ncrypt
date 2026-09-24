package com.k3ncrypt.app

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.K3ncryptSecureDatabase
import com.k3ncrypt.storage.KeystoreAead
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Verifies encrypted conversation metadata remains selectable across a Room reopen. */
@RunWith(AndroidJUnit4::class)
class ConversationRestorationTest {
    @Test
    fun savedTrustedConversationRemainsSelectableAfterDatabaseReopen() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "conversation-index-${UUID.randomUUID()}.db"
        val trusted = invitation("trusted-room", "trusted-route", "K3 trusted-peer")
        val pending = invitation("pending-room", "", "")
        val aead = KeystoreAead("k3ncrypt.android.test.conversation-index")
        var database = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, databaseName).build()
        try {
            val state = CryptoStateStore(database, aead)
            state.write("conversation", trusted.conversationId, encode(trusted))
            state.write("conversation", pending.conversationId, encode(pending))
            state.write("conversation-active", "selected", pending.conversationId.encodeToByteArray())
            state.write("session", trusted.peerRoutingId, byteArrayOf(1, 2, 3, 4))
            database.close()

            database = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, databaseName).build()
            val restored = CryptoStateStore(database, aead)
            val invitations = restored.list("conversation").map { (_, bytes) ->
                try { decode(bytes.decodeToString()) } finally { bytes.fill(0) }
            }
            val selected = SavedConversationIndex.selectTrusted(
                SavedConversationIndex.hash(trusted.conversationId),
                invitations,
            )

            assertEquals(trusted, selected)
            assertNull(SavedConversationIndex.selectTrusted(SavedConversationIndex.hash(pending.conversationId), invitations))
            assertEquals(pending.conversationId, restored.read("conversation-active", "selected")!!.decodeToString())
            val savedSession = requireNotNull(restored.read("session", trusted.peerRoutingId))
            try { assertTrue(savedSession.isNotEmpty()) } finally { savedSession.fill(0) }

            restored.write("conversation-active", "selected", requireNotNull(selected).conversationId.encodeToByteArray())
            assertEquals(trusted.conversationId, restored.read("conversation-active", "selected")!!.decodeToString())
        } finally {
            database.close()
            context.deleteDatabase(databaseName)
        }
    }

    private fun encode(value: ConversationInvitation) = JSONObject()
        .put("conversationId", value.conversationId)
        .put("localRoutingId", value.localRoutingId)
        .put("peerRoutingId", value.peerRoutingId)
        .put("peerIdentityReference", value.peerIdentityReference)
        .put("controlCapability", value.controlCapability)
        .put("routingProof", value.routingProof)
        .toString().encodeToByteArray()

    private fun decode(value: String) = JSONObject(value).let {
        ConversationInvitation(
            it.getString("conversationId"), it.getString("localRoutingId"), it.getString("peerRoutingId"),
            it.getString("peerIdentityReference"), it.getString("controlCapability"), it.getString("routingProof"),
        )
    }

    private fun invitation(id: String, peerRoute: String, peerIdentity: String) = ConversationInvitation(
        id, "local-route", peerRoute, peerIdentity, "test-capability", "test-routing-proof",
    )
}
