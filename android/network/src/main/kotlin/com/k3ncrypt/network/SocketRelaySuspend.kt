package com.k3ncrypt.network

import com.k3ncrypt.security.ProofCarrier
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import kotlin.coroutines.resume

suspend fun SocketRelay.awaitConnected(timeoutMillis: Long = 20_000) = withTimeout(timeoutMillis) { connected.first { it } }

suspend fun SocketRelay.joinAndReplay(join: RelayJoin, timeoutMillis: Long = 20_000) = withTimeout(timeoutMillis) {
    suspendCancellableCoroutine { continuation -> join(join) { accepted -> if (continuation.isActive) continuation.resume(accepted) } }
        .also { check(it) { "Relay join was rejected" } }
    suspendCancellableCoroutine { continuation -> requestMailboxReplay { accepted -> if (continuation.isActive) continuation.resume(accepted) } }
        .also { check(it) { "Mailbox replay was rejected" } }
}

suspend fun SocketRelay.sendEnvelopeAwait(envelope: String, recipientRoutingId: String, proof: ProofCarrier, timeoutMillis: Long = 20_000): RelaySendReceipt = withTimeout(timeoutMillis) {
    suspendCancellableCoroutine { continuation ->
        sendEnvelope(envelope, recipientRoutingId, proof) { raw ->
            if (continuation.isActive) {
                if (raw != null) continuation.resume(raw)
                else continuation.cancel(java.util.concurrent.CancellationException("Message relay rejected"))
            }
        }
    }
}
