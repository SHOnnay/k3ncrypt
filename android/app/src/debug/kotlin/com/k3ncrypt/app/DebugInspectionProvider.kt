package com.k3ncrypt.app

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Bundle
import android.util.Base64

/**
 * Debug APK-only inspection surface for instrumentation and local emulator
 * validation. The provider intentionally exposes only non-secret operational
 * metadata. It is absent from release manifests.
 */
class DebugInspectionProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor {
        require(uri.path == "/inspection") { "Unknown debug inspection path" }
        val snapshot = DebugInspectionStore.snapshot()
        return MatrixCursor(COLUMNS).apply {
            if (snapshot != null) {
                addRow(arrayOf(snapshot.conversationHash, snapshot.trustState, snapshot.connectionState, snapshot.deliveryState, snapshot.lastActivityTimestamp, DebugInspectionStore.stageHistory().joinToString(";"), snapshot.connectionPhase, DebugInspectionStore.callSignalStageHistory().joinToString(";")))
            }
        }
    }

    override fun getType(uri: Uri): String = "vnd.android.cursor.item/vnd.com.k3ncrypt.debug-inspection"

    /**
     * Lets a local debug test prefill the normal join UI without shell text
     * encoding altering a modern invitation. It does not join, verify, or
     * reveal anything; MainActivity still follows its normal parser and
     * fingerprint-confirmation path.
     */
    override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
        require(method == "seedJoin") { "Unknown debug method" }
        val invitation = decode(extras?.getString("invitationBase64"))
        require(invitation.isNotBlank()) { "Debug join seed is incomplete" }
        DebugJoinSeed.seed(requireNotNull(context), invitation)
        return Bundle().apply { putBoolean("accepted", true) }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

    private companion object {
        val COLUMNS = arrayOf("conversationHash", "trustState", "connectionState", "deliveryState", "lastActivityTimestamp", "messageDeliveryStages", "connectionPhase", "callSignalStages")

        fun decode(value: String?): String = String(
            Base64.decode(requireNotNull(value), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING),
            Charsets.UTF_8,
        )
    }
}
