package com.k3ncrypt.experiment.localsession

import org.junit.Assert.*
import org.junit.Test

class ExperimentBoundsTest {
    @Test fun outboundQueueEnforcesFrameAndByteBounds() {
        val queue = OutboundFrameQueue(maxFrames = 2, maxBytes = 7)
        assertTrue(queue.offer(byteArrayOf(1, 2, 3)))
        assertTrue(queue.offer(byteArrayOf(4, 5, 6, 7)))
        assertFalse(queue.offer(byteArrayOf(8)))
        assertEquals(2, queue.size())
        assertArrayEquals(byteArrayOf(1, 2, 3), queue.take())
        queue.clear()
        assertEquals(0, queue.size())
    }

    @Test fun hintsDeduplicateBoundCapacityAndExpireFromFirstSeen() {
        val hints = BoundedHintSet<String, String>(maxSize = 2, ttlMs = 30)
        assertTrue(hints.putIfFresh("a", "first", 0))
        assertFalse(hints.putIfFresh("a", "duplicate", 20))
        assertEquals("first", hints.get("a", 29))
        assertNull(hints.get("a", 30))
        assertTrue(hints.putIfFresh("b", "second", 31))
        assertTrue(hints.putIfFresh("c", "third", 32))
        assertFalse(hints.putIfFresh("d", "overflow", 33))
    }

    @Test fun stateRejectsInvalidTransitionsAndAcceptsAdvertiserFlow() {
        val state = ExperimentState()
        assertFalse(state.transition(0, Stage.CONNECTED, "forged"))
        val generation = state.begin("advertiser")
        assertFalse(state.transition(generation, Stage.CONNECTED, "skip acceptance"))
        assertTrue(state.transition(generation, Stage.WAITING_ACCEPTANCE, "accept"))
        assertTrue(state.transition(generation, Stage.CONNECTING, "connect"))
        assertTrue(state.transition(generation, Stage.CONNECTED, "connected"))
    }

    @Test fun teardownFencesOldGenerationAndClearsMessages() {
        val state = ExperimentState()
        val first = state.begin("discoverer")
        state.transition(first, Stage.PEER_FOUND, "found")
        state.transition(first, Stage.CONNECTING, "connecting")
        state.transition(first, Stage.CONNECTED, "connected")
        state.append(first, "test")
        val stopGeneration = state.stop(SafeReason.USER_ENDED)
        assertTrue(stopGeneration > first)
        assertFalse(state.append(first, "late callback"))
        assertTrue(state.value.messages.isEmpty())
    }

    @Test fun expiryIsFiniteAndControllerRecreationStartsInactive() {
        val original = ExperimentState()
        val gen = original.begin("advertiser")
        assertTrue(original.expire(gen))
        assertEquals(Stage.FAILED, original.value.stage)
        assertEquals(Stage.INACTIVE, ExperimentState().value.stage)
    }

    @Test fun unsupportedNetworkFailsWithoutStartingDiscovery() {
        val state = ExperimentState()
        state.stop(SafeReason.USER_ENDED)
        state.failBeforeStart(SafeReason.UNSUPPORTED_NETWORK_PROFILE, "Wi-Fi unavailable")
        assertEquals(Stage.FAILED, state.value.stage)
        assertEquals(SafeReason.UNSUPPORTED_NETWORK_PROFILE, state.value.reason)
    }

    @Test fun duplicateDiscoveryDoesNotCreateAnotherHint() {
        val hints = BoundedHintSet<String, Int>()
        assertTrue(hints.putIfFresh("lsx-random", 1, 100))
        assertFalse(hints.putIfFresh("lsx-random", 2, 101))
        assertEquals(1, hints.size(102))
        assertEquals(1, hints.values(102).single())
    }
}
