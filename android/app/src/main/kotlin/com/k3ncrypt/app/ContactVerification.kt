package com.k3ncrypt.app

import com.k3ncrypt.storage.CryptoStateStore
import org.json.JSONObject

internal enum class ContactVerificationState { CONTACT_CREATED, VERIFIED }

/** A local, explicit user decision, bound to the exact pinned peer. Missing legacy records fail closed. */
internal class ContactVerification(private val storage: CryptoStateStore) {
    suspend fun state(binding: ConversationInvitation): ContactVerificationState {
        if (!SavedConversationIndex.hasPinnedPeer(binding)) return ContactVerificationState.CONTACT_CREATED
        val bytes = storage.read("contact-verification-v1", SavedConversationIndex.hash(binding.conversationId))
            ?: return ContactVerificationState.CONTACT_CREATED
        return try {
            val record = JSONObject(bytes.decodeToString())
            if (record.getInt("version") == 1 && record.getString("state") == "VERIFIED" &&
                record.getString("peerRoutingId") == binding.peerRoutingId &&
                record.getString("peerIdentityReference") == binding.peerIdentityReference
            ) ContactVerificationState.VERIFIED else ContactVerificationState.CONTACT_CREATED
        } catch (_: Exception) {
            ContactVerificationState.CONTACT_CREATED
        } finally { bytes.fill(0) }
    }

    suspend fun markVerified(binding: ConversationInvitation, confirmedFingerprint: String) {
        require(SavedConversationIndex.hasPinnedPeer(binding)) { "Contact identity is not available" }
        require(confirmedFingerprint == binding.peerIdentityReference) { "Contact fingerprint did not match" }
        storage.write("contact-verification-v1", SavedConversationIndex.hash(binding.conversationId), JSONObject()
            .put("version", 1).put("state", "VERIFIED")
            .put("peerRoutingId", binding.peerRoutingId)
            .put("peerIdentityReference", binding.peerIdentityReference)
            .toString().encodeToByteArray())
    }
}
