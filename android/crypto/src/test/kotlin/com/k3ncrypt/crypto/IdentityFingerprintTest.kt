package com.k3ncrypt.crypto

import org.junit.Assert.assertEquals
import org.json.JSONObject
import java.io.File
import org.junit.Test

class IdentityFingerprintTest {
    @Test fun `fingerprint is stable across unpadded base64url`() {
        val identity = PublicIdentity("AQIDBAUGBwgJCgsMDQ4PEA", "ERITFBUWFxgZGhscHR4fIA")
        assertEquals(IdentityFingerprint.generate(identity), IdentityFingerprint.generate(identity.copy()))
    }

    @Test fun `identity fingerprint matches shared TypeScript backend fixture`() {
        val fixture = sharedFixture("identity-fingerprints.json")
        val accepted = fixture.getJSONObject("accepted")
        assertEquals(
            accepted.getString("fingerprint"),
            IdentityFingerprint.generate(PublicIdentity(accepted.getString("curve25519"), accepted.getString("ed25519"))),
        )
    }

    private fun sharedFixture(name: String): JSONObject {
        var directory: File? = File(System.getProperty("user.dir"))
        repeat(8) {
            val candidate = directory?.resolve("protocol-fixtures/v1/$name")
            if (candidate?.isFile == true) return JSONObject(candidate.readText())
            directory = directory?.parentFile
        }
        error("Shared protocol fixture not found: $name")
    }
}
