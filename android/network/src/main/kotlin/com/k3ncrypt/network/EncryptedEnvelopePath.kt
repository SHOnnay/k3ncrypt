package com.k3ncrypt.network

/** Transport kind is routing metadata only and carries no trust or verification meaning. */
enum class DeliveryPathKind { RELAY, LAN, DIRECT }

data class DeliveryPathCapabilities(
    val path: DeliveryPathKind,
    val encryptedEnvelopes: Boolean,
    val messageDelivery: Boolean,
    val offlineMailbox: Boolean,
)

data class DeliverySubmissionResult(val id: String? = null, val timestamp: Long? = null)

/**
 * Future adapter contract for an already encrypted serialized application
 * envelope. No plaintext, crypto session, identity key, or relay proof is passed.
 * AndroidMessagingRepository continues to use SocketRelay in this phase.
 */
interface EncryptedEnvelopePath {
    val capabilities: DeliveryPathCapabilities
    suspend fun submit(envelope: String, recipientRoutingId: String?): DeliverySubmissionResult
}
