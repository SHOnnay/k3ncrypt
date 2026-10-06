package com.k3ncrypt.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.provider.DocumentsContract
import android.os.StatFs
import com.k3ncrypt.media.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID

internal data class ReceivedFile(val file: File, val filename: String)
internal class AndroidFileTransfer(private val context: Context, private val messaging: AndroidMessagingRepository) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val progressMutable = MutableStateFlow(FileProgress())
    val progress: StateFlow<FileProgress> = progressMutable
    private val receivedMutable = MutableStateFlow<ReceivedFile?>(null)
    val received: StateFlow<ReceivedFile?> = receivedMutable
    private val state = FileTransferState { progressMutable.value = it }
    private val aead = AttachmentAead()
    private val directory = File(context.cacheDir, "file-transfer-v2")
    private val initialized = scope.async { directory.deleteRecursively(); check(directory.mkdirs() || directory.isDirectory) { "file-storage-full" } }
    private var job: Job? = null
    @Volatile private var activeOutput: File? = null
    @Volatile private var disposed = false
    private data class Pending(val uri: Uri, val binding: ConversationInvitation, val ownIdentity: String, val reference: JSONObject, val key: ByteArray, val size: Long, val name: String, val cacheDirectory: File)
    @Volatile private var pending: Pending? = null
    private fun fence(g: Long) { check(state.live(g)) { "file-canceled" }; if (job?.isCancelled == true) throw CancellationException() }
    private suspend fun request(p: Pending, path: String, method: String, op: String, json: JSONObject? = null, sealed: SealedAttachmentObject? = null): JSONObject = messaging.fileRequest(path, method, op, p.binding, json, sealed?.ciphertextAndTag, sealed?.nonce?.let(::b64))
    fun send(uri: Uri) {
        if (disposed || job?.isActive == true) return
        job = scope.launch {
            initialized.await(); release(true); receivedMutable.value?.file?.delete(); receivedMutable.value = null
            val g = state.begin(0)
            try {
                require(uri.scheme == "content") { "file-uri-required" }
                val metadata = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                    check(cursor.moveToFirst()) { "file-metadata-unavailable" }
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE); check(sizeIndex >= 0 && !cursor.isNull(sizeIndex)) { "file-size-unknown" }
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    (if (nameIndex >= 0) cursor.getString(nameIndex) ?: "protected-file" else "protected-file") to cursor.getLong(sizeIndex)
                } ?: error("file-metadata-unavailable")
                check(metadata.second in 1..FileTransferLimits.MAX_FILE_SIZE) { "file-size-limit" }
                space(12L * 1024 * 1024)
                val (binding, ownIdentity) = messaging.fileBinding(true); fence(g)
                val created = messaging.fileRequest("create", "POST", "attachment:create", binding, JSONObject().put("version", 2).put("binding", bindingJson(binding, ownIdentity)).put("fileSize", metadata.second))
                val c = parseContext(created.getJSONObject("context")); FileTransferLimits.validate(c)
                checkBinding(c, binding, ownIdentity, true)
                val key = ByteArray(32).also(SecureRandom()::nextBytes)
                val reference = JSONObject().put("version", 2).put("context", contextJson(c)).put("key", b64(key)).put("createdAt", created.getLong("createdAt")).put("expiresAt", created.getLong("expiresAt"))
                val p = Pending(uri, binding, ownIdentity, reference, key, metadata.second, metadata.first, File(directory, c.transferId).also { check(it.mkdirs() || it.isDirectory) { "file-storage-full" } }); synchronized(state) { try { fence(g); pending = p } catch (e: Exception) { key.fill(0); p.cacheDirectory.deleteRecursively(); throw e } }
                fence(g); checkStatus(p, created)
                val manifest = AttachmentAead.decodeManifest(AttachmentAead.encodeManifest(AttachmentManifestV2(c.fileSize, c.chunkSize, c.chunkCount, reference.getLong("createdAt"), reference.getLong("expiresAt"), metadata.first, context.contentResolver.getType(uri) ?: "application/octet-stream")))
                state.details(g, c.fileSize, manifest.filename)
                cache(p, "manifest", aead.encryptManifest(key, c, manifest)); fence(g)
                upload(p, g)
            } catch (e: Exception) { failed(g, e) }
        }
    }
    fun retry() {
        val p = pending ?: return
        if (job?.isActive == true || state.value.phase != FilePhase.Failed || !state.value.retryable) return
        job = scope.launch { val g = state.begin(p.size, p.name); try { upload(p, g) } catch (e: Exception) { failed(g, e) } }
    }
    private suspend fun authorize(p: Pending, g: Long) {
        val (binding, own) = messaging.fileBinding(true); check(binding == p.binding && own == p.ownIdentity) { "file-contact-changed" }; fence(g)
    }
    private suspend fun upload(p: Pending, g: Long) {
        authorize(p, g); val c = parseContext(p.reference.getJSONObject("context")); val id = c.transferId
        var status = request(p, id, "GET", "attachment:read"); fence(g); checkStatus(p, status)
        state.move(g, FilePhase.Encrypting)
        val manifest = cached(p, "manifest") ?: error("file-cache-unavailable")
        state.move(g, FilePhase.Uploading)
        if (!status.has("manifest")) { status = request(p, "$id/manifest", "PUT", "attachment:write", objectJson(manifest)); fence(g); checkStatus(p, status) }
        else check(sameObject(parseObject(status.getJSONObject("manifest"), FileTransferLimits.MAX_METADATA), manifest)) { "file-conflict" }
        var accepted = acceptedBytes(status, c); state.move(g, FilePhase.Uploading, accepted)
        for (i in 0 until c.chunkCount) {
            authorize(p, g)
            if (indices(status).contains(i)) continue
            var sealed = cached(p, i.toString())
            if (sealed == null) {
                state.move(g, FilePhase.Encrypting, accepted)
                val count = minOf(c.chunkSize.toLong(), c.fileSize - i.toLong() * c.chunkSize).toInt()
                val bytes = readChunk(p.uri, i.toLong() * c.chunkSize, count, p.size, g); fence(g)
                try { sealed = aead.encryptChunk(p.key, c.copy(chunkIndex = i), bytes) } finally { bytes.fill(0) }
                fence(g); cache(p, i.toString(), sealed); fence(g)
            }
            state.move(g, FilePhase.Uploading, accepted)
            status = request(p, "$id/chunks/$i", "PUT", "attachment:write", sealed = sealed); fence(g); checkStatus(p, status)
            accepted = acceptedBytes(status, c); state.move(g, FilePhase.Uploading, accepted)
        }
        authorize(p, g); val completed = request(p, "$id/complete", "POST", "attachment:write"); fence(g); checkStatus(p, completed)
        check(completed.getString("state") == "available" && indices(completed).size == c.chunkCount) { "file-incomplete" }
        authorize(p, g)
        // Existing messaging storage protects this reference and key at rest with its existing reviewed vault.
        messaging.sendText(FileTransferLimits.PREFIX + p.reference.toString()); fence(g)
        state.move(g, FilePhase.WaitingForRecipient, c.fileSize); release(false)
    }
    fun receive(text: String) {
        if (disposed || job?.isActive == true) return
        job = scope.launch {
            initialized.await(); release(true); receivedMutable.value?.file?.delete(); receivedMutable.value = null
            val g = state.begin(0); val output = File(directory, "incomplete-${UUID.randomUUID()}"); activeOutput = output; var key: ByteArray? = null
            try {
                val r = parseReference(text); val c = parseContext(r.getJSONObject("context"))
                val (binding, own) = messaging.fileBinding(false); fence(g); checkBinding(c, binding, own, false)
                key = unb64(r.getString("key"), 32); check(key.size == 32)
                val status = messaging.fileRequest(c.transferId, "GET", "attachment:read", binding); fence(g)
                checkStatusFields(r, status); check(status.getString("state") == "available" && indices(status).size == c.chunkCount && status.has("manifest")) { "file-incomplete" }
                state.move(g, FilePhase.Downloading)
                val manifest = aead.decryptManifest(key, c, parseObject(status.getJSONObject("manifest"), FileTransferLimits.MAX_METADATA)); fence(g)
                check(manifest.createdAt == r.getLong("createdAt") && manifest.expiresAt == r.getLong("expiresAt")) { "file-manifest-binding" }
                state.details(g, c.fileSize, manifest.filename)
                space(c.fileSize); var total = 0L
                output.outputStream().use { stream ->
                    for (i in 0 until c.chunkCount) {
                        val now = messaging.fileBinding(false); check(now.first == binding && now.second == own) { "file-contact-changed" }; fence(g)
                        val objectValue = messaging.fileRequest("${c.transferId}/chunks/$i", "GET", "attachment:read", binding); fence(g)
                        state.move(g, FilePhase.Verifying, total)
                        val bytes = aead.decryptChunk(key, c.copy(chunkIndex = i), parseObject(objectValue, c.chunkSize + 16))
                        try { fence(g); stream.write(bytes); total += bytes.size } finally { bytes.fill(0) }
                        fence(g); if (i + 1 < c.chunkCount) state.move(g, FilePhase.Downloading, total)
                    }
                    stream.fd.sync()
                }
                check(total == c.fileSize && output.length() == c.fileSize) { "file-incomplete" }; fence(g)
                receivedMutable.value = ReceivedFile(output, manifest.filename); state.move(g, FilePhase.Complete, total)
            } catch (e: Exception) { output.delete(); failed(g, e) } finally { key?.fill(0); if (activeOutput == output) activeOutput = null }
        }
    }
    fun save(uri: Uri) {
        val result = receivedMutable.value ?: return
        if (disposed || job?.isActive == true) return
        job = scope.launch {
            try {
                check(uri.scheme == "content"); result.file.inputStream().use { input -> context.contentResolver.openOutputStream(uri, "wt")?.use { out -> input.copyTo(out, FileTransferLimits.CHUNK_SIZE) } ?: error("file-output-unavailable") }
                result.file.delete(); receivedMutable.value = null
            } catch (_: Exception) {
                val removed = runCatching { DocumentsContract.deleteDocument(context.contentResolver, uri) }.getOrDefault(false)
                progressMutable.value = progressMutable.value.copy(failure = if (removed) "Saving failed; partial output removed. Choose a destination with space." else "Saving failed. A partial file may remain at the chosen destination; remove it before retrying.")
            }
        }
    }
    fun cancel() {
        state.cancel(); job?.cancel(); val p = pending; pending = null; p?.key?.fill(0)
        val partial = activeOutput; activeOutput = null; val result = receivedMutable.value; receivedMutable.value = null
        scope.launch { try { partial?.delete(); result?.file?.delete(); p?.cacheDirectory?.deleteRecursively(); if (p != null) runCatching { request(p, parseContext(p.reference.getJSONObject("context")).transferId, "DELETE", "attachment:delete") } } finally { if (disposed) scope.cancel() } }
    }
    fun dispose() { disposed = true; cancel() }
    private suspend fun release(cancel: Boolean) { val p = pending; pending = null; if (p != null) { p.key.fill(0); p.cacheDirectory.deleteRecursively(); if (cancel) runCatching { request(p, parseContext(p.reference.getJSONObject("context")).transferId, "DELETE", "attachment:delete") } } }
    private fun failed(g: Long, e: Exception) {
        if (e is CancellationException) return
        val reason = e.message.orEmpty(); val retry = pending != null && reason == "file-network-unavailable"
        val failure = when { reason == "file-size-unknown" -> "Document size is unavailable. Select a document that reports its size."; reason == "file-size-limit" -> "File must be between 1 byte and 8 MiB."; e is SecurityException || reason.contains("uri") -> "Document access unavailable. Select the original file again."; reason.contains("expired") -> "File expired."; reason.contains("quota") -> "File storage quota reached."; reason.contains("storage") || e is java.io.IOException -> "Local storage unavailable or full. Select the file again."; reason.contains("verification") || reason.contains("contact") -> "Verify the unchanged contact before sending."; retry -> "Network unavailable. Retry this transfer in this session."; else -> "File transfer rejected. Select the file again to restart." }
        state.move(g, if (reason.contains("expired")) FilePhase.Expired else FilePhase.Failed, failure = failure, retryable = retry)
    }
    private fun space(required: Long) { check(StatFs(context.cacheDir.path).availableBytes > required + 1024 * 1024) { "file-storage-full" } }
    private fun readChunk(uri: Uri, offset: Long, count: Int, size: Long, g: Long): ByteArray = context.contentResolver.openInputStream(uri)?.use { input -> readFileSlice(input, offset, count, size) { fence(g) } } ?: error("file-uri-unavailable")
    private fun cache(p: Pending, index: String, value: SealedAttachmentObject) { val tmp = File(p.cacheDirectory, "sealed-$index.tmp"); tmp.outputStream().use { it.write(value.nonce); it.write(value.ciphertextAndTag); it.fd.sync() }; check(tmp.renameTo(File(p.cacheDirectory, "sealed-$index"))) { "file-storage-full" } }
    private fun cached(p: Pending, index: String): SealedAttachmentObject? { val file = File(p.cacheDirectory, "sealed-$index"); if (!file.exists()) return null; check(file.length() in 28..262172); return file.inputStream().use { val nonce = ByteArray(12); check(it.read(nonce) == 12); val bytes = it.readBytes(); SealedAttachmentObject(nonce, bytes) } }
    companion object {
        private fun exact(v: JSONObject, keys: Set<String>) { check(v.keys().asSequence().toSet() == keys) { "file-version-or-schema-rejected" } }
        private fun number(v: JSONObject, key: String): Long { val n = v.get(key); check(n is Int || n is Long); return (n as Number).toLong() }
        private fun b64(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        private fun unb64(value: String, max: Int): ByteArray { check(value.length <= (max * 4 + 2) / 3 && value.matches(Regex("[A-Za-z0-9_-]+"))); val bytes = Base64.getUrlDecoder().decode(value); check(bytes.size <= max && b64(bytes) == value); return bytes }
        private fun objectJson(v: SealedAttachmentObject) = JSONObject().put("nonce", b64(v.nonce)).put("ciphertext", b64(v.ciphertextAndTag))
        private fun parseObject(v: JSONObject, max: Int): SealedAttachmentObject { exact(v, setOf("nonce", "ciphertext")); return SealedAttachmentObject(unb64(v.getString("nonce"), 12).also { check(it.size == 12) }, unb64(v.getString("ciphertext"), max).also { check(it.size >= 16) }) }
        private fun sameObject(a: SealedAttachmentObject, b: SealedAttachmentObject) = a.nonce.contentEquals(b.nonce) && a.ciphertextAndTag.contentEquals(b.ciphertextAndTag)
        private fun bindingJson(b: ConversationInvitation, own: String) = JSONObject().put("conversationId", b.conversationId).put("senderParticipantId", b.localRoutingId).put("recipientParticipantId", b.peerRoutingId).put("senderIdentityReference", own).put("recipientIdentityReference", b.peerIdentityReference)
        private fun contextJson(c: AttachmentContext) = JSONObject().put("transferId", c.transferId).put("conversationId", c.conversationId).put("senderParticipantId", c.senderParticipantId).put("recipientParticipantId", c.recipientParticipantId).put("senderIdentityReference", c.senderIdentityReference).put("recipientIdentityReference", c.recipientIdentityReference).put("fileSize", c.fileSize).put("chunkSize", c.chunkSize).put("chunkCount", c.chunkCount)
        private fun parseContext(v: JSONObject): AttachmentContext {
            exact(v, setOf("transferId", "conversationId", "senderParticipantId", "recipientParticipantId", "senderIdentityReference", "recipientIdentityReference", "fileSize", "chunkSize", "chunkCount"))
            val chunkSize = number(v, "chunkSize"); val chunkCount = number(v, "chunkCount"); check(chunkSize == FileTransferLimits.CHUNK_SIZE.toLong() && chunkCount in 1..32)
            return AttachmentContext(v.getString("transferId"), v.getString("conversationId"), v.getString("senderParticipantId"), v.getString("recipientParticipantId"), v.getString("senderIdentityReference"), v.getString("recipientIdentityReference"), number(v, "fileSize"), chunkSize.toInt(), chunkCount.toInt()).also(FileTransferLimits::validate)
        }
        internal fun parseReference(text: String): JSONObject {
            check(text.startsWith(FileTransferLimits.PREFIX) && text.length <= 4096) { "file-version-rejected" }
            val r = JSONObject(text.removePrefix(FileTransferLimits.PREFIX)); exact(r, setOf("version", "context", "key", "createdAt", "expiresAt")); check(number(r, "version") == 2L); parseContext(r.getJSONObject("context")); check(unb64(r.getString("key"), 32).size == 32); val created = number(r, "createdAt"); check(created >= 0 && number(r, "expiresAt") == created + FileTransferLimits.EXPIRY); return r
        }
        internal fun validateOutgoingReference(text: String, binding: ConversationInvitation, own: String) {
            val r = parseReference(text); checkBinding(parseContext(r.getJSONObject("context")), binding, own, true)
            check(number(r, "expiresAt") > System.currentTimeMillis()) { "file-expired" }
        }
        private fun checkBinding(c: AttachmentContext, b: ConversationInvitation, own: String, sending: Boolean) { check(c.conversationId == b.conversationId && c.senderParticipantId == (if (sending) b.localRoutingId else b.peerRoutingId) && c.recipientParticipantId == (if (sending) b.peerRoutingId else b.localRoutingId) && c.senderIdentityReference == (if (sending) own else b.peerIdentityReference) && c.recipientIdentityReference == (if (sending) b.peerIdentityReference else own)) { "file-contact-binding" } }
        private fun indices(s: JSONObject): Set<Int> { val a = s.getJSONArray("indices"); val result = (0 until a.length()).map { val v = a.get(it); check(v is Int && v in 0..31); v }; check(result.toSet().size == result.size); return result.toSet() }
        private fun acceptedBytes(s: JSONObject, c: AttachmentContext) = indices(s).sumOf { minOf(c.chunkSize.toLong(), c.fileSize - it.toLong() * c.chunkSize) }
        private fun checkStatus(p: Pending, s: JSONObject) = checkStatusFields(p.reference, s)
        private fun checkStatusFields(r: JSONObject, s: JSONObject) { check(number(s, "version") == 2L && parseContext(r.getJSONObject("context")) == parseContext(s.getJSONObject("context")) && number(r, "createdAt") == number(s, "createdAt") && number(r, "expiresAt") == number(s, "expiresAt")); val c = parseContext(r.getJSONObject("context")); check(indices(s).all { it < c.chunkCount }); check(number(s, "expiresAt") > System.currentTimeMillis() && s.getString("state") != "expired") { "file-expired" }; check(s.getString("state") in setOf("available", "incomplete")) { "file-canceled" } }
    }
}
