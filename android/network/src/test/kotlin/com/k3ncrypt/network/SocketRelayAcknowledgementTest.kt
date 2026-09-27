package com.k3ncrypt.network

import org.junit.Assert.assertEquals
import org.junit.Test
import org.json.JSONObject

class SocketRelayAcknowledgementTest {
    @Test fun `call signal ack responses map to safe categories`() {
        assertEquals("accepted", callSignalAckCategory(JSONObject().put("status", "ok")))
        assertEquals("proof_rejected", callSignalAckCategory(JSONObject().put("error", "Device authorization rejected.")))
        assertEquals("recipient_unavailable", callSignalAckCategory(JSONObject().put("error", "No receiver is in the channel.")))
        assertEquals("rejected", callSignalAckCategory(JSONObject().put("error", "unrecognized sensitive detail")))
        assertEquals("invalid_response", callSignalAckCategory(null))
    }

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
