package com.k3ncrypt.app

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.K3ncryptSecureDatabase
import com.k3ncrypt.storage.KeystoreAead
import com.k3ncrypt.storage.LocalVaultGate
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
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
