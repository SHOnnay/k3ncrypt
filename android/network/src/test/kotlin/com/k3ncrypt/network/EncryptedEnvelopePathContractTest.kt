package com.k3ncrypt.network

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class EncryptedEnvelopePathContractTest {
    @Test fun `in-process fake LAN path forwards only the same opaque envelope`() = runBlocking {
        val opaqueEnvelope = String(charArrayOf('{', '"', 'c', 'i', 'p', 'h', 'e', 'r', 't', 'e', 'x', 't', '"', ':', '"', 'd', 'u', 'm', 'm', 'y', '"', '}'))
        var received: String? = null
        val path = object : EncryptedEnvelopePath {
            override val capabilities = DeliveryPathCapabilities(DeliveryPathKind.LAN, true, true, false)
            override suspend fun submit(envelope: String, recipientRoutingId: String?): DeliverySubmissionResult {
                received = envelope
                return DeliverySubmissionResult("in-process-1", 1)
            }
        }

        val result = path.submit(opaqueEnvelope, "ephemeral-peer")
        assertEquals(opaqueEnvelope, received)
        assertSame(opaqueEnvelope, received)
        assertEquals(DeliveryPathKind.LAN, path.capabilities.path)
        assertEquals("in-process-1", result.id)
    }
}
