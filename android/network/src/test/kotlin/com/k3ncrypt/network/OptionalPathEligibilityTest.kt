package com.k3ncrypt.network

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

class OptionalPathEligibilityTest {
    private fun fixture(): JSONObject {
        var directory = File(System.getProperty("user.dir")).canonicalFile
        repeat(8) {
            val candidate = File(directory, "protocol-fixtures/v1/optional-path-eligibility.json")
            if (candidate.isFile) return JSONObject(candidate.readText())
            directory = directory.parentFile ?: return@repeat
        }
        error("Shared optional-path eligibility fixture was not found from the Gradle test directory.")
    }

    @Test fun `matches the shared TypeScript eligibility fixtures`() {
        val cases = fixture().getJSONArray("cases")
        for (index in 0 until cases.length()) {
            val item = cases.getJSONObject(index)
            val readiness = item.getJSONObject("readiness")
            val value = OptionalPathReadiness(
                featureEnabled = readiness.getBoolean("featureEnabled"),
                privacyAllowsAddressDisclosure = readiness.getBoolean("privacyAllowsAddressDisclosure"),
                contactVerifiedAndUnchanged = readiness.getBoolean("contactVerifiedAndUnchanged"),
                requiredTrustFreshnessAvailable = readiness.getBoolean("requiredTrustFreshnessAvailable"),
                capabilitiesAuthenticated = readiness.getBoolean("capabilitiesAuthenticated"),
                peerAdmissionAuthenticatedAndCurrent = readiness.getBoolean("peerAdmissionAuthenticatedAndCurrent"),
                stableEnvelopeIdentityAvailable = readiness.getBoolean("stableEnvelopeIdentityAvailable"),
                receiverDeduplicatesBeforeDecrypt = readiness.getBoolean("receiverDeduplicatesBeforeDecrypt"),
                sharedDedupeHorizonDefined = readiness.getBoolean("sharedDedupeHorizonDefined"),
                acceptanceCrashConsistent = readiness.getBoolean("acceptanceCrashConsistent"),
                authenticatedReceiptAvailable = readiness.getBoolean("authenticatedReceiptAvailable"),
                outboxCompletionSupportsPath = readiness.getBoolean("outboxCompletionSupportsPath"),
            )
            val blockers = item.getJSONArray("blockers").let { values -> List(values.length()) { values.getString(it) } }
            assertEquals(item.getString("name"), blockers, OptionalPathEligibility.blockers(value))
            assertEquals(item.getString("name"), item.getBoolean("eligible"), OptionalPathEligibility.isEligible(DeliveryPathKind.LAN, value))
        }
    }

    @Test fun `relay does not need optional path eligibility`() {
        val unready = OptionalPathReadiness(false, false, false, false, false, false, false, false, false, false, false, false)
        assertFalse(OptionalPathEligibility.isEligible(DeliveryPathKind.RELAY, unready))
    }

    @Test fun `LAN and direct delivery build flags remain disabled`() {
        assertFalse(ConnectivityFeatureFlags.lanDelivery)
        assertFalse(ConnectivityFeatureFlags.directDelivery)
    }
}
