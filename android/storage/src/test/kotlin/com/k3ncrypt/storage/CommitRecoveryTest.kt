package com.k3ncrypt.storage

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CommitRecoveryTest {
    @Test fun `only committed crypto state is acknowledged`() {
        assertFalse(CommitRecovery.shouldAcknowledge(null)); assertFalse(CommitRecovery.shouldAcknowledge(CommitPhase.PREPARED)); assertFalse(CommitRecovery.shouldAcknowledge(CommitPhase.ACCOUNT_WRITTEN)); assertTrue(CommitRecovery.shouldAcknowledge(CommitPhase.COMMITTED))
    }
}
