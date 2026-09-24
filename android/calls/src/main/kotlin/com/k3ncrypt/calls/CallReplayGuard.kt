package com.k3ncrypt.calls

/** Process-local replay window for short-lived call signals; encrypted transport replay checks remain authoritative too. */
class CallReplayGuard(private val maxEntries: Int = 512) {
    private val nonces = linkedMapOf<String, Long>()
    private val finishedCalls = linkedMapOf<String, Long>()

    @Synchronized fun accept(callId: String, nonce: String, expiresAt: Long, now: Long): Boolean {
        nonces.entries.removeAll { it.value <= now }
        finishedCalls.entries.removeAll { it.value <= now }
        if (expiresAt <= now || finishedCalls.containsKey(callId) || nonces.containsKey(nonce)) return false
        nonces[nonce] = expiresAt
        trim(nonces)
        return true
    }

    @Synchronized fun finish(callId: String, expiresAt: Long, now: Long) {
        if (expiresAt <= now) return
        finishedCalls[callId] = expiresAt
        trim(finishedCalls)
    }

    private fun trim(values: LinkedHashMap<String, Long>) {
        while (values.size > maxEntries) values.remove(values.keys.first())
    }
}
