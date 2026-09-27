package com.k3ncrypt.app

/** Distinguishes the initial connection from a later socket reconnection. */
internal class RelayPresenceReconnectTracker {
    private var hasConnected = false
    private var currentlyConnected = false

    /** Returns true once for each disconnected -> reconnected transition. */
    @Synchronized
    fun onConnectionChanged(connected: Boolean): Boolean {
        if (!connected) {
            currentlyConnected = false
            return false
        }
        if (!hasConnected) {
            hasConnected = true
            currentlyConnected = true
            return false
        }
        if (currentlyConnected) return false
        currentlyConnected = true
        return true
    }
}
