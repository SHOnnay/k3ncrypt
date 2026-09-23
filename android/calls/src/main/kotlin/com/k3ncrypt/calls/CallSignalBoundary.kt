package com.k3ncrypt.calls

import com.k3ncrypt.security.DeviceAuthorizationProof
import com.k3ncrypt.security.ProofGuard
import com.k3ncrypt.security.ProofResource

data class ProtectedCallSignal(val conversationId: String, val encryptedEnvelope: String, val proof: DeviceAuthorizationProof)

/** Calls reuse encrypted signaling and relay:signal proof scope; WebRTC negotiation is added in Phase 9.5. */
class CallSignalBoundary(private val now: () -> Long = { System.currentTimeMillis() }) {
    fun authorize(signal: ProtectedCallSignal): Boolean {
        require(signal.encryptedEnvelope.isNotBlank())
        return ProofGuard.validateFor(signal.proof, "relay:signal", ProofResource(conversationId = signal.conversationId), now()).isSuccess
    }
}
