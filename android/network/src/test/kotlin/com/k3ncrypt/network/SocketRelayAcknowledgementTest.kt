package com.k3ncrypt.network

import org.junit.Assert.assertEquals
import org.junit.Test

class SocketRelayAcknowledgementTest {
    @Test fun `accepted replay emits received before positive socket acknowledgement`() {
        val calls = mutableListOf<String>()
        acknowledgeMailboxDelivery("delivery-1", true,
            emitReceived = { calls += "received:$it" },
            acknowledge = { calls += "ack:$it" })

        assertEquals(listOf("received:delivery-1", "ack:true"), calls)
    }

    @Test fun `rejected replay is not marked received`() {
        val calls = mutableListOf<String>()
        acknowledgeMailboxDelivery("delivery-1", false,
            emitReceived = { calls += "received:$it" },
            acknowledge = { calls += "ack:$it" })

        assertEquals(listOf("ack:false"), calls)
    }
}
