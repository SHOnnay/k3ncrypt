package com.k3ncrypt.app

import com.k3ncrypt.media.FilePhase
import com.k3ncrypt.media.FileProgress

internal data class AndroidFileTransferPresentation(
    val label: String,
    val progress: Float? = null,
    val active: Boolean = false,
)

internal fun androidFileTransferPresentation(state: FileProgress): AndroidFileTransferPresentation {
    val ratio = if (state.total > 0L) (state.bytes.toFloat() / state.total).coerceIn(0f, 1f) else null
    val percent = ratio?.let { (it * 100).toInt() }
    val progress = if (state.phase in setOf(FilePhase.Uploading, FilePhase.Downloading, FilePhase.Verifying)) ratio else null
    val name = state.filename.takeIf(String::isNotBlank)?.let { "$it · " }.orEmpty()
    return when (state.phase) {
        FilePhase.Preparing -> AndroidFileTransferPresentation("${name}Preparing…", active = true)
        FilePhase.Encrypting -> AndroidFileTransferPresentation("${name}Protecting file…", active = true)
        FilePhase.Uploading -> AndroidFileTransferPresentation("${name}Sending…${percent?.let { " $it%" }.orEmpty()}", progress, active = true)
        FilePhase.WaitingForRecipient -> AndroidFileTransferPresentation("${name}Sent securely · waiting for your contact")
        FilePhase.Downloading -> AndroidFileTransferPresentation("${name}Downloading…${percent?.let { " $it%" }.orEmpty()}", progress, active = true)
        FilePhase.Verifying -> AndroidFileTransferPresentation("${name}Checking received file…${percent?.let { " $it%" }.orEmpty()}", progress, active = true)
        FilePhase.Complete -> AndroidFileTransferPresentation("${name}Ready to save")
        FilePhase.Canceled -> AndroidFileTransferPresentation("${name}Transfer canceled")
        FilePhase.Expired -> AndroidFileTransferPresentation("This file has expired. Ask your contact to send it again.")
        FilePhase.RestartRequired -> AndroidFileTransferPresentation("This transfer was interrupted when the app closed. Select the original file to start again.")
        FilePhase.Failed -> AndroidFileTransferPresentation(failureCopy(state.failure))
    }
}

private fun failureCopy(failure: String): String {
    val reason = failure.lowercase()
    return when {
        "8 mib" in reason || "file-size" in reason -> "Files must be 8 MiB or smaller."
        "expired" in reason -> "This file has expired. Ask your contact to send it again."
        "verification" in reason || "identity" in reason || "contact" in reason -> "Verify this contact again before sending files."
        "quota" in reason || "storage" in reason || "full" in reason -> "There is not enough storage. Free some space, then try again."
        "cache" in reason || "restart" in reason || "process" in reason -> "This transfer was interrupted when the app closed. Select the original file to start again."
        "network" in reason || "unavailable" in reason || "timeout" in reason || "request-failed" in reason -> "Could not connect. Check your connection and retry in this session."
        else -> "The transfer could not finish. Retry in this session or select the file again."
    }
}
