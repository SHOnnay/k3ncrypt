package com.k3ncrypt.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NetworkEndpointTest {
    @Test fun acceptsHttpsAndAndroidEmulatorHost() {
        assertEquals("https://relay.example.org", NetworkEndpoint.validate("https://relay.example.org/"))
        assertEquals("http://10.0.2.2:3001", NetworkEndpoint.validate(" http://10.0.2.2:3001/ "))
    }

    @Test fun rejectsInsecureOrAmbiguousEndpoints() {
        listOf("http://localhost:3001", "http://192.168.1.10:3001", "https://relay.example.org/path", "https://user:pass@relay.example.org", "javascript:alert(1)").forEach { endpoint ->
            assertThrows(IllegalArgumentException::class.java) { NetworkEndpoint.validate(endpoint) }
        }
    }
}
