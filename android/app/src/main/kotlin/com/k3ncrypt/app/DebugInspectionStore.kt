package com.k3ncrypt.app

import android.content.Context
/**
 * In-memory metadata used exclusively by the debug-source-set inspection
 * provider. This deliberately never stores invitation capabilities, proofs,
 * encrypted envelopes, or key material.
 */
internal object DebugInspectionStore {
    @Volatile private var conversationHash: String? = null
    @Volatile private var trustState: String = "unknown"
    @Volatile private var connectionState: String = "not_started"
    @Volatile private var connectionPhase: String = "not_started"
    @Volatile private var deliveryState: String = "idle"
    @Volatile private var lastActivityTimestamp: Long = 0L
    @Volatile private var deliveryStage: String? = null
    private val deliveryStages = java.util.concurrent.CopyOnWriteArrayList<String>()

    fun update(
        conversationId: String?,
        trustState: String,
        connectionState: String,
        deliveryState: String,
        lastActivityTimestamp: Long,
    ) {
        if (!BuildConfig.DEBUG) return
        this.conversationHash = conversationId?.let(SavedConversationIndex::hash)
        this.trustState = trustState
        this.connectionState = connectionState
        this.deliveryState = this.deliveryStage?.let { "test:$it" } ?: deliveryState
        this.lastActivityTimestamp = lastActivityTimestamp
    }

    /** Internal debug-build delivery stage; never includes message or authorization data. */
    fun setDeliveryStage(stage: String) {
        if (BuildConfig.DEBUG) {
            deliveryStage = stage
            deliveryStages.add(stage)
            while (deliveryStages.size > 64) deliveryStages.removeAt(0)
        }
    }

    fun stageHistory(): List<String> = if (BuildConfig.DEBUG) deliveryStages.toList() else emptyList()

    /** Safe connection phase label for isolated interoperability diagnostics. */
    fun setConnectionStage(stage: String) {
        if (BuildConfig.DEBUG) {
            connectionPhase = stage
            connectionState = "test:$stage"
        }
    }

    fun snapshot(): DebugInspectionSnapshot? = if (BuildConfig.DEBUG) {
        DebugInspectionSnapshot(conversationHash, trustState, connectionState, deliveryState, lastActivityTimestamp, connectionPhase)
    } else {
        null
    }
}

internal data class DebugInspectionSnapshot(
    val conversationHash: String?,
    val trustState: String,
    val connectionState: String,
    val deliveryState: String,
    val lastActivityTimestamp: Long,
    val connectionPhase: String,
)

/** Debug APK-only test input. The production implementation is inert. */
internal object DebugJoinSeed {
    private const val preferencesName = "debug-join-seed"
    private const val invitationKey = "invitation"

    fun seed(context: Context, invitation: String) {
        if (!BuildConfig.DEBUG) return
        context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).edit()
            .putString(invitationKey, invitation)
            .apply()
    }

    fun consume(context: Context): String? {
        if (!BuildConfig.DEBUG) return null
        val preferences = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
        val invitation = preferences.getString(invitationKey, null)
        preferences.edit().clear().apply()
        return invitation
    }
}
