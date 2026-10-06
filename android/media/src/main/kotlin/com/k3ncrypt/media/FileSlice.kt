package com.k3ncrypt.media
import java.io.InputStream
/** Reads only one declared chunk from a content stream; unknown/changed sizes fail closed. Caller owns closing the stream. */
fun readFileSlice(input: InputStream, offset: Long, count: Int, size: Long, checkActive: () -> Unit = {}): ByteArray {
    require(size in 1..FileTransferLimits.MAX_FILE_SIZE && offset >= 0 && offset < size && count in 1..FileTransferLimits.CHUNK_SIZE && offset + count <= size)
    var skip = offset; val scratch = ByteArray(8192)
    while (skip > 0) { checkActive(); val n = input.read(scratch, 0, minOf(skip, scratch.size.toLong()).toInt()); check(n > 0) { "file-source-size-changed" }; skip -= n }
    val bytes = ByteArray(count)
    try {
        var at = 0; while (at < count) { checkActive(); val n = input.read(bytes, at, count - at); check(n > 0) { "file-source-size-changed" }; at += n }
        checkActive(); if (offset + count == size) check(input.read() == -1) { "file-source-size-changed" }; return bytes
    } catch (e: Exception) { bytes.fill(0); throw e } finally { scratch.fill(0) }
}
