package com.k3ncrypt.media
object FileTransferLimits {
    const val MAX_FILE_SIZE = 8L * 1024 * 1024
    const val CHUNK_SIZE = 256 * 1024
    const val MAX_CHUNKS = 32
    const val MAX_METADATA = 2048
    const val EXPIRY = 24L * 60 * 60 * 1000
    const val PREFIX = "k3ncrypt-file-v2:"
    fun validate(context: AttachmentContext) {
        AttachmentAead.encodeContext(AttachmentObjectType.MANIFEST, context)
        require(context.fileSize <= MAX_FILE_SIZE && context.chunkSize == CHUNK_SIZE && context.chunkCount <= MAX_CHUNKS && context.chunkIndex == null)
    }
}
enum class FilePhase { Preparing, Encrypting, Uploading, WaitingForRecipient, Downloading, Verifying, Complete, Canceled, Failed, Expired, RestartRequired }
data class FileProgress(val phase: FilePhase = FilePhase.RestartRequired, val bytes: Long = 0, val total: Long = 0, val filename: String = "", val failure: String = "", val retryable: Boolean = false)
/** Terminal generations cannot be resurrected; retry explicitly starts a new generation. */
class FileTransferState(private val changed: (FileProgress) -> Unit = {}) {
    private var generation = 0L
    var value = FileProgress(); private set
    @Synchronized fun begin(total: Long, filename: String = ""): Long { generation++; value = FileProgress(FilePhase.Preparing, total = total, filename = filename); changed(value); return generation }
    @Synchronized fun live(g: Long) = g == generation && !terminal(value.phase)
    @Synchronized fun move(g: Long, phase: FilePhase, bytes: Long = value.bytes, failure: String = "", retryable: Boolean = false): Boolean {
        if (!live(g) || !legal(value.phase, phase)) return false
        value = value.copy(phase = phase, bytes = bytes, failure = failure, retryable = retryable); changed(value); return true
    }
    @Synchronized fun details(g: Long, total: Long, filename: String) { if (!live(g)) return; value = value.copy(total = total, filename = filename); changed(value) }
    @Synchronized fun cancel() { if (live(generation)) move(generation, FilePhase.Canceled); generation++ }
    companion object {
        fun terminal(phase: FilePhase) = phase in setOf(FilePhase.WaitingForRecipient, FilePhase.Complete, FilePhase.Canceled, FilePhase.Failed, FilePhase.Expired, FilePhase.RestartRequired)
        fun legal(from: FilePhase, to: FilePhase): Boolean {
            if (terminal(from)) return false
            if (from == to || to in setOf(FilePhase.Failed, FilePhase.Expired, FilePhase.Canceled, FilePhase.RestartRequired)) return true
            return when (from) {
                FilePhase.Preparing -> to in setOf(FilePhase.Encrypting, FilePhase.Downloading)
                FilePhase.Encrypting -> to == FilePhase.Uploading
                FilePhase.Uploading -> to in setOf(FilePhase.Encrypting, FilePhase.WaitingForRecipient)
                FilePhase.Downloading -> to == FilePhase.Verifying
                FilePhase.Verifying -> to in setOf(FilePhase.Downloading, FilePhase.Complete)
                else -> false
            }
        }
    }
}

/** Process-only marker: a lost sealed object is never regenerated under the same transfer key. */
class SealedObjectInventory {
    private val produced = mutableSetOf<String>()
    @Synchronized fun beforeSeal(index: String) {
        require(index == "manifest" || index.toIntOrNull()?.let { it in 0 until FileTransferLimits.MAX_CHUNKS } == true)
        check(produced.size < FileTransferLimits.MAX_CHUNKS + 1 && produced.add(index)) { "file-cache-unavailable" }
    }
}
