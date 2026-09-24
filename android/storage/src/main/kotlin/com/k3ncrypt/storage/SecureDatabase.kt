package com.k3ncrypt.storage

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.withTransaction
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Entity(tableName = "secure_records", primaryKeys = ["namespace", "recordId"])
data class SecureRecordEntity(val namespace: String, val recordId: String, val ciphertext: ByteArray, val updatedAt: Long)

@Dao
interface SecureRecordDao {
    @Query("SELECT * FROM secure_records WHERE namespace = :namespace AND recordId = :recordId")
    suspend fun get(namespace: String, recordId: String): SecureRecordEntity?
    @Query("SELECT * FROM secure_records WHERE namespace = :namespace ORDER BY updatedAt, recordId")
    suspend fun list(namespace: String): List<SecureRecordEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(record: SecureRecordEntity)
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIfAbsent(record: SecureRecordEntity): Long
    @Query("DELETE FROM secure_records WHERE namespace = :namespace AND recordId = :recordId")
    suspend fun remove(namespace: String, recordId: String)
}

@Database(entities = [SecureRecordEntity::class], version = 1, exportSchema = true)
abstract class K3ncryptSecureDatabase : RoomDatabase() { abstract fun records(): SecureRecordDao }

/** AES-GCM key material is non-exportable and remains in Android Keystore. */
class KeystoreAead(private val alias: String = "k3ncrypt.android.v1.storage") {
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance("AES", "AndroidKeyStore")
        generator.init(android.security.keystore.KeyGenParameterSpec.Builder(alias, android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(false)
            .build())
        return generator.generateKey()
    }

    fun encrypt(plaintext: ByteArray, aad: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()); updateAAD(aad) }
        return cipher.iv + cipher.doFinal(plaintext)
    }
    fun decrypt(sealed: ByteArray, aad: ByteArray): ByteArray {
        require(sealed.size > 12 + 16) { "Corrupted encrypted record" }
        return Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed.copyOfRange(0, 12))); updateAAD(aad) }.doFinal(sealed.copyOfRange(12, sealed.size))
    }
}

class EncryptedRecordStore(private val database: K3ncryptSecureDatabase, private val aead: KeystoreAead, private val now: () -> Long = { System.currentTimeMillis() }) {
    private fun aad(namespace: String, id: String) = "k3ncrypt:android:storage:v1:$namespace:$id".encodeToByteArray()
    suspend fun get(namespace: String, id: String): ByteArray? = database.records().get(namespace, id)?.let { aead.decrypt(it.ciphertext, aad(namespace, id)) }
    suspend fun list(namespace: String): List<Pair<String, ByteArray>> = database.records().list(namespace).map { it.recordId to aead.decrypt(it.ciphertext, aad(namespace, it.recordId)) }
    suspend fun put(namespace: String, id: String, value: ByteArray) { database.records().put(SecureRecordEntity(namespace, id, aead.encrypt(value, aad(namespace, id)), now())) }
    suspend fun remove(namespace: String, id: String) { database.records().remove(namespace, id) }
    suspend fun <T> transaction(block: suspend SecureRecordDao.() -> T): T = database.withTransaction { database.records().block() }
    internal fun seal(namespace: String, id: String, value: ByteArray): SecureRecordEntity = SecureRecordEntity(namespace, id, aead.encrypt(value, aad(namespace, id)), now())
    internal fun open(record: SecureRecordEntity): ByteArray = aead.decrypt(record.ciphertext, aad(record.namespace, record.recordId))
}
