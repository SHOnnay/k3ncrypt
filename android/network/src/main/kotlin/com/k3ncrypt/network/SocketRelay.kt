package com.k3ncrypt.network

import com.k3ncrypt.security.ProofCarrier
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject

data class RelayJoin(val routingId: String, val conversationId: String, val controlCapability: String, val routingProof: String, val proof: ProofCarrier)
data class RelayDelivery(val id: String, val timestamp: Long, val sender: String, val envelope: String, val conversationId: String)
data class RelaySendReceipt(val id: String, val timestamp: Long)

/** Socket.IO only transports encrypted envelopes. It never decrypts or accepts a mailbox item itself. */
class SocketRelay(url: String) {
    @Volatile private var socket: Socket? = null
    private val _connected = MutableStateFlow(false)
    @Volatile private var activeConversationId: String? = null
    @Volatile private var lastJoinFailureCategory: String? = null
    private val pendingDeliveryListeners = java.util.concurrent.CopyOnWriteArrayList<(RelayDelivery, (Boolean) -> Unit) -> Unit>()
    val connected: StateFlow<Boolean> = _connected
    fun lastJoinFailureCategory(): String? = lastJoinFailureCategory
    init {
        if (url.isNotBlank()) configureUrl(url)
    }
    @Synchronized fun configureUrl(url: String) {
        val normalized = NetworkEndpoint.validate(url)
        socket?.let { it.off(); it.disconnect() }
        val created = IO.socket(normalized)
        created.on(Socket.EVENT_CONNECT, io.socket.emitter.Emitter.Listener { _connected.value = true })
        created.on(Socket.EVENT_DISCONNECT, io.socket.emitter.Emitter.Listener { _connected.value = false })
        socket = created
        pendingDeliveryListeners.forEach { attachDeliveryListener(created, it) }
    }
    fun connect() = (socket ?: error("backend_endpoint_unconfigured")).connect()
    fun close() { activeConversationId = null; _connected.value = false; socket?.disconnect() }
    fun join(value: RelayJoin, ack: (Boolean) -> Unit) {
        require(value.proof.deviceAuthorizationProof.resource?.conversationId == value.conversationId)
        activeConversationId = value.conversationId
        val payload = JSONObject().put("userID", value.routingId).put("channelID", value.conversationId).put("controlCapability", value.controlCapability).put("routingProof", value.routingProof)
            .put("deviceAuthorizationProof", proofJson(value.proof)).put("proofNonce", value.proof.proofNonce)
        (socket ?: error("backend_endpoint_unconfigured")).emit("chat-join", payload, io.socket.client.Ack { response ->
            val result = response.firstOrNull() as? JSONObject
            val accepted = result?.optString("status") == "accepted"
            lastJoinFailureCategory = if (accepted) null else result?.optString("code")?.takeIf { it.isNotBlank() } ?: "join-rejected"
            ack(accepted)
        })
    }
    fun requestMailboxReplay(ack: (Boolean) -> Unit) { (socket ?: error("backend_endpoint_unconfigured")).emit("mailbox-replay", JSONObject(), io.socket.client.Ack { response -> ack((response.firstOrNull() as? JSONObject)?.optString("status") == "accepted") }) }
    fun sendEnvelope(envelope: String, recipientRoutingId: String?, proof: ProofCarrier, ack: (RelaySendReceipt?) -> Unit) {
        val conversationId = activeConversationId ?: run { ack(null); return }
        if (proof.deviceAuthorizationProof.operation != "relay:message" || proof.deviceAuthorizationProof.resource?.conversationId != conversationId || proof.proofNonce != proof.deviceAuthorizationProof.nonce) { ack(null); return }
        val payload = JSONObject().put("envelope", JSONObject(envelope)).put("deviceAuthorizationProof", proofJson(proof)).put("proofNonce", proof.proofNonce).put("proofOperation", "relay:message")
        recipientRoutingId?.let { payload.put("recipientRoutingId", it) }
        val activeSocket = socket ?: run { ack(null); return }
        activeSocket.emit("chat-message", payload, io.socket.client.Ack { response ->
            val value = response.firstOrNull() as? JSONObject
            if (value == null || !value.has("id") || !value.has("timestamp")) ack(null)
            else ack(RelaySendReceipt(value.getString("id"), value.getLong("timestamp")))
        })
    }
    fun onDelivery(listener: (RelayDelivery, (Boolean) -> Unit) -> Unit) {
        pendingDeliveryListeners.add(listener)
        socket?.let { attachDeliveryListener(it, listener) }
    }
    private fun attachDeliveryListener(socket: Socket, listener: (RelayDelivery, (Boolean) -> Unit) -> Unit) { socket.on("chat-message", io.socket.emitter.Emitter.Listener { args ->
        val raw = args.firstOrNull() as? JSONObject
        val acceptance = args.lastOrNull() as? io.socket.client.Ack
        if (raw == null || acceptance == null) return@Listener
        val conversationId = activeConversationId ?: run { acceptance.call(JSONObject().put("accepted", false)); return@Listener }
        val delivery = RelayDelivery(raw.getString("id"), raw.getLong("timestamp"), raw.getString("sender"), raw.getJSONObject("envelope").toString(), conversationId)
        try {
            listener(delivery) { accepted ->
                acknowledgeMailboxDelivery(delivery.id, accepted,
                    emitReceived = { id -> socket.emit("received", JSONObject().put("id", id)) },
                    acknowledge = { value -> acceptance.call(JSONObject().put("accepted", value)) })
            }
        } catch (_: Exception) { acceptance.call(JSONObject().put("accepted", false)) }
    }) }
    private fun proofJson(carrier: ProofCarrier): JSONObject = carrier.deviceAuthorizationProof.let { proof ->
        val resource = proof.resource?.let { r -> linkedMapOf<String, Any?>().apply { r.conversationId?.let { put("conversationId", it) }; r.networkId?.let { put("networkId", it) }; r.attachmentId?.let { put("attachmentId", it) }; r.bridgeRouteId?.let { put("bridgeRouteId", it) } } }
        val json = CanonicalJson.objectOf(listOf("version" to proof.version, "proofId" to proof.proofId, "accountIdentityReference" to proof.accountIdentityReference,
            "deviceId" to proof.deviceId, "deviceIdentityReference" to proof.deviceIdentityReference, "operation" to proof.operation,
            "trustEpoch" to proof.trustEpoch, "nonce" to proof.nonce, "resource" to resource, "issuedAt" to proof.issuedAt,
            "expiresAt" to proof.expiresAt, "signature" to proof.signature))
        JSONObject(json)
    }
}

/** Mirrors the browser relay contract: report delivery only after processing accepts the envelope. */
internal fun acknowledgeMailboxDelivery(
    deliveryId: String,
    accepted: Boolean,
    emitReceived: (String) -> Unit,
    acknowledge: (Boolean) -> Unit,
) {
    if (accepted) emitReceived(deliveryId)
    acknowledge(accepted)
}
