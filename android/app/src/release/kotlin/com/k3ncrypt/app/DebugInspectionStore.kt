package com.k3ncrypt.app

import com.k3ncrypt.calls.AndroidCallHealthSnapshot
import com.k3ncrypt.calls.AndroidRemoteDescriptionDiagnostic

/** Release variant has no diagnostic storage or inspection surface. */
internal object DebugInspectionStore {
    fun setDeliveryStage(stage: String) = Unit
    fun setCallSignalStage(stage: String) = Unit
    fun setIceDiagnostic(stage: String) = Unit
    fun clearCallSignalStages() = Unit
    fun beginCallTimingTrace() = Unit
    fun setSdpObserverStage(stage: String) = Unit
    fun recordRemoteDescriptionDiagnostic(value: AndroidRemoteDescriptionDiagnostic) = Unit
    fun setCallTimingDiagnostic(stage: String) = Unit
    fun recordCallHealthSnapshot(value: AndroidCallHealthSnapshot) = Unit
    fun setCallSignalResultCategory(category: String) = Unit
    fun setCallDigestInputDiagnostic(kind: String, inputLength: Int, payloadJsonLength: Int, sdpValueLength: Int, metadataLength: Int, escapingCategory: String) = Unit
    fun setInboundMessageResultCategory(category: String) = Unit
    fun setConnectionStage(stage: String) = Unit
}
