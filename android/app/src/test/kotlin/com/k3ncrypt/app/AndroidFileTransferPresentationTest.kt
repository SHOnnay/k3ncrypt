package com.k3ncrypt.app

import com.k3ncrypt.media.FilePhase
import com.k3ncrypt.media.FileProgress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidFileTransferPresentationTest {
    @Test fun uploadProgressUsesHumanCopyAndPercent() {
        val copy = androidFileTransferPresentation(FileProgress(FilePhase.Uploading, bytes = 25, total = 100, filename = "photo.jpg"))
        assertEquals("photo.jpg · Sending… 25%", copy.label)
        assertEquals(0.25f, copy.progress)
        assertTrue(copy.active)
    }

    @Test fun completedAndWaitingTransfersDoNotClaimPeerDelivery() {
        assertEquals("Ready to save", androidFileTransferPresentation(FileProgress(FilePhase.Complete, bytes = 100, total = 100)).label)
        val pending = androidFileTransferPresentation(FileProgress(FilePhase.WaitingForRecipient, filename = "photo.jpg"))
        assertEquals("photo.jpg · Sent securely · waiting for your contact", pending.label)
        assertFalse(pending.label.contains("Delivered"))
    }

    @Test fun internalFailureReasonsAreReplacedWithUsefulCopy() {
        val copy = androidFileTransferPresentation(FileProgress(FilePhase.Failed, failure = "attachment:create request-failed"))
        assertEquals("Could not connect. Check your connection and retry in this session.", copy.label)
        assertFalse(copy.label.contains("request-failed"))
    }
}
