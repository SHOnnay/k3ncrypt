package com.k3ncrypt.network

import org.junit.Assert.assertEquals
import org.junit.Test

class CanonicalJsonTest {
    @Test fun `optional fields are omitted with stable order`() {
        assertEquals("{\"version\":1,\"deviceId\":\"d\",\"epoch\":2}", CanonicalJson.objectOf(listOf("version" to 1, "deviceId" to "d", "resource" to null, "epoch" to 2)))
    }
}
