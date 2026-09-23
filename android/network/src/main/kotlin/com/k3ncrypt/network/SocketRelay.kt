package com.k3ncrypt.network

import com.k3ncrypt.security.ProofCarrier
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject

data class RelayJoin(val routingId: String, val conversationId: String, val controlCapability: String, val routingProof: String, val proof: ProofCarrier)
data class RelayDelivery(val id: String, val timestamp: Long, val sender: String, val envelope: String)

/** Socket.IO only transports encrypted envelopes. It never decrypts or accepts a mailbox item itself. */
class SocketRelay(url: String) {
    private val socket: Socket = IO.socket(url)
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected
    init {
        socket.on(Socket.EVENT_CONNECT, io.socket.emitter.Emitter.Listener { _connected.value = true })
        socket.on(Socket.EVENT_DISCONNECT, io.socket.emitter.Emitter.Listener { _connected.value = false })
    }
    fun connect() = socket.connect()
    fun close() = socket.disconnect()
    fun join(value: RelayJoin, ack: (Boolean) -> Unit) {
        val payload = JSONObject().put("userID", value.routingId).put("channelID", value.conversationId).put("controlCapability", value.controlCapability).put("routingProof", value.routingProof)
            .put("deviceAuthorizationProof", proofJson(value.proof)).put("proofNonce", value.proof.proofNonce)
        socket.emit("chat-join", payload, io.socket.client.Ack { response -> ack((response.firstOrNull() as? JSONObject)?.optString("status") == "accepted") })
    }
    fun requestMailboxReplay(ack: (Boolean) -> Unit) { socket.emit("mailbox-replay", JSONObject(), io.socket.client.Ack { response -> ack((response.firstOrNull() as? JSONObject)?.optString("status") == "accepted") }) }
    fun sendEnvelope(envelope: String, recipientRoutingId: String?, proof: ProofCarrier, ack: (Boolean) -> Unit) {
        val payload = JSONObject().put("envelope", JSONObject(envelope)).put("deviceAuthorizationProof", proofJson(proof)).put("proofNonce", proof.proofNonce).put("proofOperation", "relay:message")
        recipientRoutingId?.let { payload.put("recipientRoutingId", it) }
        socket.emit("chat-message", payload, io.socket.client.Ack { response -> ack((response.firstOrNull() as? JSONObject)?.has("id") == true) })
    }
    fun onDelivery(listener: (RelayDelivery, (Boolean) -> Unit) -> Unit) { socket.on("chat-message", io.socket.emitter.Emitter.Listener { args ->
        val raw = args.firstOrNull() as? JSONObject
        val acceptance = args.lastOrNull() as? io.socket.client.Ack
        if (raw == null || acceptance == null) return@Listener
        val delivery = RelayDelivery(raw.getString("id"), raw.getLong("timestamp"), raw.getString("sender"), raw.getJSONObject("envelope").toString())
        listener(delivery) { accepted ->
            acknowledgeMailboxDelivery(delivery.id, accepted,
                emitReceived = { id -> socket.emit("received", JSONObject().put("id", id)) },
                acknowledge = { value -> acceptance.call(JSONObject().put("accepted", value)) })
        }
    }) }
    private fun proofJson(carrier: ProofCarrier): JSONObject = carrier.deviceAuthorizationProof.let { proof ->
        JSONObject().put("version", proof.version).put("proofId", proof.proofId).put("accountIdentityReference", proof.accountIdentityReference).put("deviceId", proof.deviceId)
            .put("deviceIdentityReference", proof.deviceIdentityReference).put("operation", proof.operation).put("trustEpoch", proof.trustEpoch).put("nonce", proof.nonce)
            .apply { proof.resource?.let { resource -> put("resource", JSONObject().apply { resource.conversationId?.let { put("conversationId", it) }; resource.networkId?.let { put("networkId", it) }; resource.attachmentId?.let { put("attachmentId", it) }; resource.bridgeRouteId?.let { put("bridgeRouteId", it) } }) } }
            .put("issuedAt", proof.issuedAt).put("expiresAt", proof.expiresAt).put("signature", proof.signature)
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
