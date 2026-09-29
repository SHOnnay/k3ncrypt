package com.k3ncrypt.app

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.k3ncrypt.crypto.NativeCryptoBridge
import com.k3ncrypt.messaging.MessageFrame
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.EncryptedRecordStore
import com.k3ncrypt.storage.InboundCommitResult
import com.k3ncrypt.storage.K3ncryptSecureDatabase
import com.k3ncrypt.storage.KeystoreAead
import com.k3ncrypt.storage.LocalVaultGate
import com.k3ncrypt.storage.SessionState
import com.k3ncrypt.storage.StoredMessage
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.MessageDigest

/** Test-only Room/JNI validation. Run prepare, kill, then verify on a disposable emulator. */
@RunWith(AndroidJUnit4::class)
class AndroidCrashRecoveryValidationTest {
    private val name = "phase1e-crash-validation.db"
    private val route = "phase1e-peer"
    private val accountId = "phase1e-account"
    private val conversationId = "phase1e-conversation"
    private fun digest(wire: String): String = MessageDigest.getInstance("SHA-256")
        .digest(wire.encodeToByteArray()).joinToString("") { "%02x".format(it) }

    @Test
    fun nativeSessionAndRoomRollbackSurviveReopenOrForceStop() = runBlocking {
        val phase = InstrumentationRegistry.getArguments().getString("crashPhase") ?: "local"
        require(phase in setOf("prepare", "kill", "verify", "local"))
        when (phase) {
            "prepare" -> prepare()
            "kill" -> killDuringInboundTransaction()
            "verify" -> verifyAndClean()
            else -> { prepare(); verifyAndClean() }
        }
    }

    private suspend fun prepare() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.deleteDatabase(name)
        val databaseDirectory = requireNotNull(context.getDatabasePath(name).parentFile)
        require(databaseDirectory.isDirectory || databaseDirectory.mkdirs())
        val database = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, name).build()
        val aead = KeystoreAead()
        LocalVaultGate(database, aead).openAfterSystemAuthentication()
        val state = CryptoStateStore(database, aead)
        val crypto = NativeCryptoBridge()
        val sender = crypto.createAccount()
        val recipient = crypto.createAccount()
        val key = ByteArray(32).also(java.security.SecureRandom()::nextBytes)
        var outgoing: com.k3ncrypt.crypto.SessionHandle? = null
        var incoming: com.k3ncrypt.crypto.SessionHandle? = null
        try {
            crypto.generateFallbackKey(recipient)
            outgoing = crypto.createOutboundSession(sender, crypto.identityKeys(recipient).curve25519, crypto.fallbackKey(recipient))
            val firstWire = crypto.encrypt(outgoing, MessageFrame.encodeText("first committed"))
            incoming = crypto.establishInboundSession(recipient, crypto.identityKeys(sender).curve25519, firstWire).session
            assertEquals(InboundCommitResult.STORED, state.commitInbound(
                accountId, crypto.saveAccount(recipient, key), SessionState(route, crypto.saveSession(incoming)),
                digest(firstWire), StoredMessage("phase1e-first", conversationId, route, "first committed", 1L),
            ))

            val secondWire = crypto.encrypt(outgoing, MessageFrame.encodeText("second rolled back"))
            assertEquals("second rolled back", MessageFrame.decodeText(crypto.decrypt(incoming, secondWire)))
            val secondDigest = digest(secondWire)
            try {
                EncryptedRecordStore(database, aead).transaction {
                    state.commitInbound(
                        accountId, crypto.saveAccount(recipient, key), SessionState(route, crypto.saveSession(incoming)),
                        secondDigest, StoredMessage("phase1e-second", conversationId, route, "second rolled back", 2L),
                    )
                    error("injected abort after inbound commit body")
                }
            } catch (error: IllegalStateException) {
                assertEquals("injected abort after inbound commit body", error.message)
            }
            assertFalse(state.hasInboundDigest(secondDigest))
            assertEquals(1, state.messages().size)
            // Test vector only; no plaintext or key is placed in this record.
            state.write("test-vector", "second-envelope", secondWire.encodeToByteArray())
        } finally {
            incoming?.let(crypto::closeSession)
            outgoing?.let(crypto::closeSession)
            crypto.closeAccount(sender)
            crypto.closeAccount(recipient)
            key.fill(0)
            database.close()
        }
    }

    private suspend fun killDuringInboundTransaction() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, name).build()
        val aead = KeystoreAead()
        LocalVaultGate(database, aead).openAfterSystemAuthentication()
        val state = CryptoStateStore(database, aead)
        val crypto = NativeCryptoBridge()
        val session = crypto.loadSession(requireNotNull(state.read("session", route)))
        try {
            val wire = requireNotNull(state.read("test-vector", "second-envelope")).decodeToString()
            assertEquals("second rolled back", MessageFrame.decodeText(crypto.decrypt(session, wire)))
            EncryptedRecordStore(database, aead).transaction {
                state.commitInbound(
                    accountId, requireNotNull(state.read("account", accountId)).decodeToString(),
                    SessionState(route, crypto.saveSession(session)), digest(wire),
                    StoredMessage("phase1e-second", conversationId, route, "second rolled back", 2L),
                )
                android.os.Process.killProcess(android.os.Process.myPid())
                error("Process kill did not take effect")
            }
        } finally {
            crypto.closeSession(session)
            database.close()
        }
    }

    private suspend fun verifyAndClean() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, name).build()
        try {
            val aead = KeystoreAead()
            LocalVaultGate(database, aead).openAfterSystemAuthentication()
            val state = CryptoStateStore(database, aead)
            assertEquals(listOf("first committed"), state.messages().map { it.text })
            val secondWire = requireNotNull(state.read("test-vector", "second-envelope")).decodeToString()
            assertFalse(state.hasInboundDigest(digest(secondWire)))
            assertTrue(state.read("message", "phase1e-second") == null)
            val crypto = NativeCryptoBridge()
            val restored = crypto.loadSession(requireNotNull(state.read("session", route)))
            try {
                assertEquals("second rolled back", MessageFrame.decodeText(crypto.decrypt(restored, secondWire)))
            } finally { crypto.closeSession(restored) }
        } finally {
            database.close()
            context.deleteDatabase(name)
        }
    }
}
