package com.k3ncrypt.media
import java.io.ByteArrayInputStream
import org.junit.Assert.*
import org.junit.Test
class FileTransferTest {
    @Test fun terminalsAndOldGenerationsCannotResurrect() {
        val s = FileTransferState(); val g = s.begin(1); assertFalse(s.move(g, FilePhase.Complete)); s.cancel(); assertFalse(s.move(g, FilePhase.Uploading)); val next = s.begin(1); assertFalse(s.move(g, FilePhase.Encrypting)); assertTrue(s.move(next, FilePhase.Failed)); assertFalse(s.move(next, FilePhase.Encrypting))
    }
    @Test fun uploadAndDownloadLegalTransitionsHaveEvidence() {
        val s = FileTransferState(); val g = s.begin(1); assertTrue(s.move(g, FilePhase.Encrypting)); assertTrue(s.move(g, FilePhase.Uploading)); assertTrue(s.move(g, FilePhase.WaitingForRecipient)); assertFalse(s.move(g, FilePhase.Complete))
        val r = s.begin(1); assertTrue(s.move(r, FilePhase.Downloading)); assertTrue(s.move(r, FilePhase.Verifying)); assertTrue(s.move(r, FilePhase.Complete)); assertFalse(s.move(r, FilePhase.Downloading))
    }
    @Test fun contentStreamSlicesAreBoundedAndOrdered() {
        val bytes = ByteArray(FileTransferLimits.CHUNK_SIZE + 7) { (it % 251).toByte() }
        val first = readFileSlice(ByteArrayInputStream(bytes), 0, FileTransferLimits.CHUNK_SIZE, bytes.size.toLong())
        val last = readFileSlice(ByteArrayInputStream(bytes), FileTransferLimits.CHUNK_SIZE.toLong(), 7, bytes.size.toLong())
        assertArrayEquals(bytes.copyOfRange(0, FileTransferLimits.CHUNK_SIZE), first); assertArrayEquals(bytes.copyOfRange(FileTransferLimits.CHUNK_SIZE, bytes.size), last)
    }
    @Test fun unknownOversizedTruncatedAndGrownSourceRejected() {
        val input = ByteArrayInputStream(byteArrayOf(1, 2))
        for (size in listOf(-1L, 0L, FileTransferLimits.MAX_FILE_SIZE + 1)) assertThrows(IllegalArgumentException::class.java) { readFileSlice(input, 0, 1, size) }
        assertThrows(IllegalStateException::class.java) { readFileSlice(ByteArrayInputStream(byteArrayOf(1)), 0, 2, 2) }
        assertThrows(IllegalStateException::class.java) { readFileSlice(ByteArrayInputStream(byteArrayOf(1, 2)), 0, 1, 1) }
        assertThrows(IllegalArgumentException::class.java) { readFileSlice(input, 0, FileTransferLimits.CHUNK_SIZE + 1, FileTransferLimits.MAX_FILE_SIZE) }
    }
    @Test fun cancellationDuringProviderReadStopsAndRestartRequiresNewTransfer() {
        var checks = 0
        assertThrows(IllegalStateException::class.java) { readFileSlice(ByteArrayInputStream(ByteArray(20000)), 10000, 1, 20000) { if (++checks > 1) error("canceled") } }
        assertEquals(FilePhase.RestartRequired, FileTransferState().value.phase)
    }
    @Test fun evictedSealedObjectsCannotBeProducedAgainAndObjectCountStaysBounded() {
        val inventory = SealedObjectInventory(); inventory.beforeSeal("manifest"); inventory.beforeSeal("0")
        assertThrows(IllegalStateException::class.java) { inventory.beforeSeal("0") }
        for (i in 1 until FileTransferLimits.MAX_CHUNKS) inventory.beforeSeal(i.toString())
        assertThrows(IllegalStateException::class.java) { inventory.beforeSeal("manifest") }
        val state = FileTransferState(); val g = state.begin(1); assertTrue(state.move(g, FilePhase.RestartRequired)); assertFalse(state.move(g, FilePhase.Encrypting))
    }
}
