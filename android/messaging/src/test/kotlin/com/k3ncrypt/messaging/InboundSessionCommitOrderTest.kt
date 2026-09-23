package com.k3ncrypt.messaging

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class InboundSessionCommitOrderTest {
    @Test fun `failed durable commit does not publish session to active map`() = runBlocking {
        val calls = mutableListOf<String>()

        try {
            persistThenRememberSession(
                persist = { calls += "persist"; throw IllegalStateException("storage unavailable") },
                remember = { calls += "remember" },
            )
        } catch (_: IllegalStateException) {
            // Expected: failed persistence must leave the session unavailable for subsequent decrypts.
        }

        assertEquals(listOf("persist"), calls)
    }

    @Test fun `session is published only after durable commit`() = runBlocking {
        val calls = mutableListOf<String>()

        persistThenRememberSession(
            persist = { calls += "persist" },
            remember = { calls += "remember" },
        )

        assertEquals(listOf("persist", "remember"), calls)
    }
}
