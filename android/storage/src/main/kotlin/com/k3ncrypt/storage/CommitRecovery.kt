package com.k3ncrypt.storage

enum class CommitPhase { PREPARED, ACCOUNT_WRITTEN, COMMITTED }

object CommitRecovery {
    /** Incomplete commits are never acknowledged; caller must replay from the mailbox. */
    fun shouldAcknowledge(phase: CommitPhase?): Boolean = phase == CommitPhase.COMMITTED
}
