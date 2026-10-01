package com.k3ncrypt.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.k3ncrypt.crypto.NativeCryptoBridge
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises the production JNI verifier, not an Android/JCA test-only substitute. */
@RunWith(AndroidJUnit4::class)
class ProductionIdentitySignatureVerificationTest {
    @Test fun fixedSharedIdentitySignatureVectorVerifiesAndRejectsChangedBytes() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val fixture = context.assets.open("verification-readiness.json").bufferedReader().use { JSONObject(it.readText()) }
        val publicKey = fixture.getJSONObject("identity").getString("ed25519")
        val vector = fixture.getJSONObject("signatureVector")
        val payload = vector.getString("canonicalPayload").encodeToByteArray()
        val signature = vector.getString("signatureBase64Url")
        val verifier = NativeCryptoBridge()

        assertTrue(verifier.verifyIdentitySignature(publicKey, payload, signature))
        assertFalse(verifier.verifyIdentitySignature(publicKey, payload + byteArrayOf('!'.code.toByte()), signature))
    }
}
