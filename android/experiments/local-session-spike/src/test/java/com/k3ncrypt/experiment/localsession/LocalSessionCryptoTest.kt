package com.k3ncrypt.experiment.localsession

import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import org.junit.Assert.*
import org.junit.Test

class LocalSessionCryptoTest {
    private val random = SecureRandom()

    @Test fun generatedPairingCodeHas100BitsOfAlphabetSpaceAndNormalizes() {
        assertEquals(32, "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toSet().size)
        repeat(32) {
            val code = LocalSessionCrypto.generatePairingCode(random)
            assertEquals(20, code.length)
            assertTrue(code.all { it in "0123456789ABCDEFGHJKMNPQRSTVWXYZ" })
            assertEquals(code, LocalSessionCrypto.normalizePairingCode(LocalSessionCrypto.formatPairingCode(code)))
        }
    }

    @Test fun invalidOrShortPairingCodesFailClosed() {
        for (bad in listOf("", "1234", "OOOO-OOOO-OOOO-OOOO-OOOO", "ABCD-EFGH-IJKL-MNOP-QRST")) {
            assertThrows(IllegalArgumentException::class.java) { LocalSessionCrypto.normalizePairingCode(bad) }
        }
    }

    @Test fun sameCodeAndTranscriptDeriveMatchingDirectionalKeysAndProofs() {
        val fixture = fixture()
        val a = LocalSessionCrypto.derive(fixture.code, fixture.transcript)
        val b = LocalSessionCrypto.derive(fixture.code, fixture.transcript)
        assertArrayEquals(a.clientToServerKey, b.clientToServerKey)
        assertArrayEquals(a.serverToClientKey, b.serverToClientKey)
        assertArrayEquals(a.clientNoncePrefix, b.clientNoncePrefix)
        assertArrayEquals(a.serverNoncePrefix, b.serverNoncePrefix)
        assertTrue(LocalSessionCrypto.verifyProof(LocalSessionCrypto.clientProof(a), LocalSessionCrypto.clientProof(b)))
        assertTrue(LocalSessionCrypto.verifyProof(LocalSessionCrypto.serverProof(a), LocalSessionCrypto.serverProof(b)))
        assertTrue(LocalSessionCrypto.verifyProof(LocalSessionCrypto.clientReadyProof(a), LocalSessionCrypto.clientReadyProof(b)))
        assertTrue(LocalSessionCrypto.verifyProof(LocalSessionCrypto.serverReadyProof(a), LocalSessionCrypto.serverReadyProof(b)))
        assertFalse(LocalSessionCrypto.verifyProof(LocalSessionCrypto.clientProof(a), LocalSessionCrypto.serverProof(a)))
        assertFalse(LocalSessionCrypto.verifyProof(LocalSessionCrypto.clientReadyProof(a), LocalSessionCrypto.serverReadyProof(a)))
        val changedProof = LocalSessionCrypto.clientReadyProof(b).also { it[0] = (it[0].toInt() xor 1).toByte() }
        assertFalse(LocalSessionCrypto.verifyProof(LocalSessionCrypto.clientReadyProof(a), changedProof))
        assertFalse(a.clientToServerKey.contentEquals(a.serverToClientKey))
        assertFalse(a.authKey.contentEquals(a.clientToServerKey))
        a.clear(); b.clear()
    }

    @Test fun freshSessionValuesProduceDifferentDirectionalKeysAndProofs() {
        val fixture = fixture()
        val freshTranscript = fixture.transcript.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        val a = LocalSessionCrypto.derive(fixture.code, fixture.transcript)
        val b = LocalSessionCrypto.derive(fixture.code, freshTranscript)
        assertFalse(a.clientToServerKey.contentEquals(b.clientToServerKey))
        assertFalse(a.serverToClientKey.contentEquals(b.serverToClientKey))
        assertFalse(a.clientNoncePrefix.contentEquals(b.clientNoncePrefix))
        assertFalse(LocalSessionCrypto.verifyProof(LocalSessionCrypto.serverReadyProof(a), LocalSessionCrypto.serverReadyProof(b)))
        a.clear(); b.clear()
    }

    @Test fun wrongPairingCodeFailsProofVerification() {
        val fixture = fixture()
        val good = LocalSessionCrypto.derive(fixture.code, fixture.transcript)
        val wrong = LocalSessionCrypto.derive("0123456789ABCDEFGHJM", fixture.transcript)
        assertFalse(LocalSessionCrypto.verifyProof(LocalSessionCrypto.clientProof(good), LocalSessionCrypto.clientProof(wrong)))
        good.clear(); wrong.clear()
    }

    @Test fun transcriptChangeFailsProofVerification() {
        val fixture = fixture()
        val changed = fixture.transcript.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        val a = LocalSessionCrypto.derive(fixture.code, fixture.transcript)
        val b = LocalSessionCrypto.derive(fixture.code, changed)
        assertFalse(LocalSessionCrypto.verifyProof(LocalSessionCrypto.serverProof(a), LocalSessionCrypto.serverProof(b)))
        a.clear(); b.clear()
    }

    @Test fun aesGcmRoundTripIsDirectionAndTranscriptBound() {
        val fixture = fixture()
        val keys = LocalSessionCrypto.derive(fixture.code, fixture.transcript)
        val plain = "PING-A".toByteArray(Charsets.US_ASCII)
        val cipher = LocalSessionCrypto.encryptText(keys.clientToServerKey, keys.clientNoncePrefix, keys.transcriptHash, 1, 1, plain)
        val decoded = LocalSessionCrypto.decryptText(keys.clientToServerKey, keys.clientNoncePrefix, keys.transcriptHash, 1, 1, cipher)
        assertArrayEquals(plain, decoded)
        assertThrows(AEADBadTagException::class.java) {
            LocalSessionCrypto.decryptText(keys.clientToServerKey, keys.clientNoncePrefix, keys.transcriptHash, 2, 1, cipher)
        }
        assertThrows(AEADBadTagException::class.java) {
            LocalSessionCrypto.decryptText(keys.clientToServerKey, keys.clientNoncePrefix, keys.transcriptHash, 1, 2, cipher)
        }
        assertThrows(AEADBadTagException::class.java) {
            LocalSessionCrypto.decryptText(keys.clientToServerKey, keys.clientNoncePrefix, keys.transcriptHash.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }, 1, 1, cipher)
        }
        assertThrows(AEADBadTagException::class.java) {
            LocalSessionCrypto.decryptText(keys.serverToClientKey, keys.serverNoncePrefix, keys.transcriptHash, 1, 1, cipher)
        }
        keys.clear(); plain.fill(0); decoded.fill(0)
    }

    @Test fun tamperedCiphertextFailsAuthentication() {
        val fixture = fixture()
        val keys = LocalSessionCrypto.derive(fixture.code, fixture.transcript)
        val plain = "HELLO-LOCAL-1".toByteArray(Charsets.US_ASCII)
        val cipher = LocalSessionCrypto.encryptText(keys.serverToClientKey, keys.serverNoncePrefix, keys.transcriptHash, 2, 9, plain)
        cipher[cipher.lastIndex] = (cipher.last().toInt() xor 1).toByte()
        assertThrows(AEADBadTagException::class.java) {
            LocalSessionCrypto.decryptText(keys.serverToClientKey, keys.serverNoncePrefix, keys.transcriptHash, 2, 9, cipher)
        }
        keys.clear(); plain.fill(0)
    }

    private fun fixture(): Fixture {
        val host = ByteArray(16) { it.toByte() }
        val client = ByteArray(16) { (it + 16).toByte() }
        val clientNonce = ByteArray(16) { (it + 32).toByte() }
        val serverNonce = ByteArray(16) { (it + 48).toByte() }
        val code = "0123456789ABCDEFGHJK"
        return Fixture(code, LocalSessionCrypto.transcript(host, client, clientNonce, serverNonce))
    }

    private data class Fixture(val code: String, val transcript: ByteArray)
}
