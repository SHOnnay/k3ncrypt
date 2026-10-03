package com.k3ncrypt.network

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Exact shared legacy evidence contract; this does not execute four live platform journeys. */
class Stage0DeliveryContractTest {
    @Test fun currentEvidenceNeverClaimsAuthenticatedPeerPersistence() {
        var directory: File? = File(System.getProperty("user.dir")!!)
        var source: File? = null
        repeat(8) {
            val candidate = directory?.resolve("protocol-fixtures/stage0/current-delivery.json")
            if (candidate?.isFile == true) source = candidate
            directory = directory?.parentFile
        }
        val fixture = JSONObject(requireNotNull(source).readText())
        assertFalse(fixture.getBoolean("authenticatedPeerPersistedImplemented"))
        val pairs = fixture.getJSONArray("pairings")
        assertEquals(setOf("Web->Web", "Web->Android", "Android->Web", "Android->Android"), (0 until pairs.length()).map { pairs.getString(it) }.toSet())
        val observations = fixture.getJSONArray("observations")
        (0 until observations.length()).forEach {
            assertFalse(observations.getJSONObject(it).getBoolean("peerPersistence"))
            assertFalse(observations.getJSONObject(it).getBoolean("authenticatedPeerEvidence"))
        }
        val stored = observations.getJSONObject(1).getJSONObject("wire")
        assertTrue(stored.getBoolean("stored"))
        assertEquals("synthetic-relay-id", stored.getString("id"))
        assertEquals(1L, stored.getLong("timestamp"))
        assertEquals("relay-submission-response", fixture.getJSONObject("completion").getString("Android"))
        assertEquals("relay-delivered-event", fixture.getJSONObject("completion").getString("Web"))
        val effects = mutableListOf<String>()
        acknowledgeMailboxDelivery(stored.getString("id"), false, { effects += "received" }, { effects += "ack:$it" })
        assertEquals(listOf("ack:false"), effects)
    }
}
