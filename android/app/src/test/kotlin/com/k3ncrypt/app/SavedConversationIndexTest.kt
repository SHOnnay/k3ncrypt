package com.k3ncrypt.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SavedConversationIndexTest {
    @Test
    fun selectsOnlyTheTrustedConversationMatchingItsStableHash() {
        val trusted = invitation("trusted-room", "peer-route", "K3 verified-peer")
        val pending = invitation("pending-room", "", "")
        val otherTrusted = invitation("other-room", "other-route", "K3 other-peer")

        val hash = SavedConversationIndex.hash(trusted.conversationId)
        assertEquals(trusted, SavedConversationIndex.selectTrusted(hash, listOf(pending, otherTrusted, trusted)))
        assertNull(SavedConversationIndex.selectTrusted(SavedConversationIndex.hash(pending.conversationId), listOf(pending)))
    }

    @Test
    fun conversationHashIsStableAndDoesNotRevealTheIdentifier() {
        val conversationId = "private-conversation-id"
        val hash = SavedConversationIndex.hash(conversationId)

        assertEquals(hash, SavedConversationIndex.hash(conversationId))
        assertNotEquals(conversationId, hash)
        assertTrue(hash.matches(Regex("[a-f0-9]{64}")))
    }

    @Test
    fun callbackAndPersistedSnapshotCanRaceWithoutDuplicatingLazyListKeys() {
        val delivered = AndroidChatMessage("delivery-1", "room", "sender", "opaque test text", 1L)
        val messages = mutableListOf<AndroidChatMessage>()

        assertTrue(appendUniqueChatMessage(messages, delivered))
        appendUniqueChatMessages(messages, listOf(delivered, delivered.copy(id = "delivery-2")))

        assertEquals(listOf("delivery-1", "delivery-2"), messages.map { it.id })
    }

    private fun invitation(id: String, peerRoute: String, peerIdentity: String) = ConversationInvitation(
        conversationId = id,
        localRoutingId = "local-route",
        peerRoutingId = peerRoute,
        peerIdentityReference = peerIdentity,
        controlCapability = "capability-is-not-in-the-summary",
        routingProof = "routing-proof-is-not-in-the-summary",
    )
}
