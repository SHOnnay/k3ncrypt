package com.k3ncrypt.app

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.K3ncryptSecureDatabase
import com.k3ncrypt.storage.KeystoreAead
import com.k3ncrypt.storage.LocalVaultGate
import com.k3ncrypt.storage.SecureStateWrite
import com.k3ncrypt.storage.SessionState
import com.k3ncrypt.storage.InboundCommitResult
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class ContactVerificationPersistenceTest {
    @Test fun joinedAndLegacyPinnedContactRemainUnverifiedUntilExplicitConfirmation() = runBlocking {
        withStore { state ->
            val binding = invitation()
            state.write("conversation", binding.conversationId, JSONObject()
                .put("conversationId", binding.conversationId)
                .put("localRoutingId", binding.localRoutingId)
                .put("peerRoutingId", binding.peerRoutingId)
                .put("peerIdentityReference", binding.peerIdentityReference)
                .put("controlCapability", binding.controlCapability)
                .put("routingProof", binding.routingProof).toString().encodeToByteArray())
            // Both a fresh join and a legacy pinned descriptor have no explicit verification record.
            val verification = ContactVerification(state)
            assertEquals(binding, SavedConversationIndex.selectPinned(SavedConversationIndex.hash(binding.conversationId), listOf(binding)))
            assertEquals(ContactVerificationState.CONTACT_CREATED, verification.state(binding))
            verification.markVerified(binding, binding.peerIdentityReference)
            assertEquals(ContactVerificationState.VERIFIED, verification.state(binding))
            assertEquals(ContactVerificationState.CONTACT_CREATED, verification.state(binding.copy(peerIdentityReference = "K3 changed")))
            assertEquals(ContactVerificationState.CONTACT_CREATED, verification.state(binding.copy(peerRoutingId = UUID.randomUUID().toString())))
        }
    }

    @Test fun verificationSurvivesRoomReopenAndInvalidComparisonDoesNotUpgrade() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "contact-verification-${UUID.randomUUID()}.db"
        val aead = KeystoreAead()
        var db = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, name).build()
        try {
            LocalVaultGate(db, aead).openAfterSystemAuthentication()
            val binding = invitation()
            val first = ContactVerification(CryptoStateStore(db, aead))
            assertEquals(ContactVerificationState.CONTACT_CREATED, first.state(binding))
            try { first.markVerified(binding, "K3 wrong"); throw AssertionError("Unexpected verification") }
            catch (_: IllegalArgumentException) { }
            assertEquals(ContactVerificationState.CONTACT_CREATED, first.state(binding))
            first.markVerified(binding, binding.peerIdentityReference)
            db.close()
            db = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, name).build()
            assertEquals(ContactVerificationState.VERIFIED, ContactVerification(CryptoStateStore(db, aead)).state(binding))
        } finally { db.close(); context.deleteDatabase(name) }
    }

    @Test fun joinIntroductionDescriptorAndReplayMarkerCommitWithoutCreatingChatMessage() = runBlocking {
        withStore { state ->
            val room = UUID.randomUUID().toString()
            val oldDescriptor = JSONObject().put("conversationId", room).put("localRoutingId", UUID.randomUUID().toString())
                .put("peerRoutingId", "").put("peerIdentityReference", "").put("controlCapability", "capability")
                .put("routingProof", "proof").toString().encodeToByteArray()
            state.write("conversation", room, oldDescriptor)
            val newDescriptor = JSONObject(oldDescriptor.decodeToString())
                .put("peerRoutingId", UUID.randomUUID().toString()).put("peerIdentityReference", "K3 unverified identity")
                .toString().encodeToByteArray()
            val replay = "event-1".encodeToByteArray()
            val result = state.commitInboundControl(
                accountId = "account",
                accountPickle = "account-pickle",
                session = SessionState("peer", byteArrayOf(1, 2, 3)),
                digest = "digest-1",
                deliveryId = "delivery-1",
                writes = listOf(SecureStateWrite("conversation", room, newDescriptor, oldDescriptor)),
                replayNamespace = "join-introduction-seen",
                replayRecordId = room,
                replayValue = replay,
            )
            assertEquals(InboundCommitResult.STORED, result)
            assertEquals(newDescriptor.decodeToString(), state.read("conversation", room)?.decodeToString())
            assertTrue(state.hasInboundDigest("digest-1"))
            assertTrue(state.messages().isEmpty())
            val discovered = ConversationInvitation(room, UUID.randomUUID().toString(), UUID.randomUUID().toString(), "K3 unverified identity", "capability", "proof")
            assertEquals(ContactVerificationState.CONTACT_CREATED, ContactVerification(state).state(discovered))
            assertEquals(
                InboundCommitResult.DUPLICATE,
                state.commitInboundControl("account", "different-account-pickle", SessionState("peer", byteArrayOf(4)), "digest-2", "delivery-2", emptyList(), "join-introduction-seen", room, replay),
            )
            assertEquals(newDescriptor.decodeToString(), state.read("conversation", room)?.decodeToString())
        }
    }

    private suspend fun withStore(block: suspend (CryptoStateStore) -> Unit) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "contact-verification-${UUID.randomUUID()}.db"
        val aead = KeystoreAead()
        val db = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, name).build()
        try { LocalVaultGate(db, aead).openAfterSystemAuthentication(); block(CryptoStateStore(db, aead)) }
        finally { db.close(); context.deleteDatabase(name) }
    }

    private fun invitation() = ConversationInvitation(UUID.randomUUID().toString(), UUID.randomUUID().toString(),
        UUID.randomUUID().toString(), "K3 peer", "capability", "proof")
}
