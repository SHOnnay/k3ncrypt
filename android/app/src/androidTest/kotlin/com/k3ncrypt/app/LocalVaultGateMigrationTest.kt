package com.k3ncrypt.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.K3ncryptSecureDatabase
import com.k3ncrypt.storage.KeystoreAead
import com.k3ncrypt.storage.LocalVaultGate
import com.k3ncrypt.storage.SecureRecordEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator

/** Run on the disposable emulator after device authentication; never targets a saved identity. */
@RunWith(AndroidJUnit4::class)
class LocalVaultGateMigrationTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val databaseName = "local-vault-migration-test.db"
    private val legacyAlias = "k3ncrypt.android.v1.storage"

    private fun sealLegacy(namespace: String, id: String, plaintext: ByteArray): ByteArray {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = (store.getKey(legacyAlias, null) as? javax.crypto.SecretKey) ?: run {
            val generator = KeyGenerator.getInstance("AES", "AndroidKeyStore")
            generator.init(KeyGenParameterSpec.Builder(legacyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setUserAuthenticationRequired(false).build())
            generator.generateKey()
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, key)
            updateAAD("k3ncrypt:android:storage:v1:$namespace:$id".encodeToByteArray())
        }
        return cipher.iv + cipher.doFinal(plaintext)
    }

    @Test fun migrationRollsBackOnBadRecordAndRestoresAcrossReopen(): Unit = runBlocking {
        context.deleteDatabase(databaseName)
        var database = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, databaseName).build()
        val original = sealLegacy("identity-checkpoint", "local", "preserved-record".encodeToByteArray())
        database.records().put(SecureRecordEntity("identity-checkpoint", "local", original, 1L))
        val keyRecord = sealLegacy("pickle-key", "device", ByteArray(32) { it.toByte() })
        database.records().put(SecureRecordEntity("pickle-key", "device", keyRecord, 1L))
        val sessionRecord = sealLegacy("session", "peer", "saved-session".encodeToByteArray())
        database.records().put(SecureRecordEntity("session", "peer", sessionRecord, 1L))
        database.records().put(SecureRecordEntity("session", "bad", byteArrayOf(1, 2, 3), 2L))
        val cipher = KeystoreAead()
        val gate = LocalVaultGate(database, cipher)
        val failed = runCatching { gate.openAfterSystemAuthentication() }
        assertTrue(failed.isFailure)
        assertArrayEquals(original, database.records().get("identity-checkpoint", "local")!!.ciphertext)
        assertNull(database.records().get("vault-format", "local"))

        database.records().remove("session", "bad")
        gate.openAfterSystemAuthentication()
        assertArrayEquals("preserved-record".encodeToByteArray(), CryptoStateStore(database, cipher).readIdentityCheckpoint())
        assertArrayEquals(ByteArray(32) { it.toByte() }, CryptoStateStore(database, cipher).read("pickle-key", "device"))
        assertArrayEquals("saved-session".encodeToByteArray(), CryptoStateStore(database, cipher).read("session", "peer"))
        database.close()

        database = Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, databaseName).build()
        val reopenedCipher = KeystoreAead()
        LocalVaultGate(database, reopenedCipher).openAfterSystemAuthentication()
        assertArrayEquals("preserved-record".encodeToByteArray(), CryptoStateStore(database, reopenedCipher).readIdentityCheckpoint())
        assertArrayEquals(ByteArray(32) { it.toByte() }, CryptoStateStore(database, reopenedCipher).read("pickle-key", "device"))
        assertArrayEquals("saved-session".encodeToByteArray(), CryptoStateStore(database, reopenedCipher).read("session", "peer"))
        database.close()
        context.deleteDatabase(databaseName)
        Unit
    }
}
