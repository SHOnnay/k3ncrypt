package com.k3ncrypt.calls

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CallSignalDigestDiagnosticTest {
    @Test
    fun digestMeasurementSeparatesOfferPayloadFromMetadataWithoutExposingContent() {
        var observed: CallSignalCodec.DigestInputDiagnostic? = null
        CallSignalCodec.installDebugDigestDiagnosticSink { observed = it }
        try {
            val sdp = "v=0\r\no=-\r\n"
            CallSignalCodec.create(
                "11111111-1111-4111-8111-111111111111",
                "22222222-2222-4222-8222-222222222222",
                "route-a",
                "device-a",
                "device-b",
                "audio",
                "connect",
                "offer",
                JSONObject().put("type", "offer").put("sdp", sdp),
                2,
                1000,
                61_000,
                "binding",
                "33333333-3333-4333-8333-333333333333",
            )
            val measurement = observed
            assertTrue(measurement != null)
            assertEquals("offer", measurement?.kind)
            assertEquals(sdp.toByteArray(Charsets.UTF_8).size, measurement?.sdpValueLength)
            assertEquals(measurement?.byteLength, (measurement?.metadataLength ?: 0) + (measurement?.payloadJsonLength ?: 0))
        } finally {
            CallSignalCodec.installDebugDigestDiagnosticSink { }
        }
    }
}
