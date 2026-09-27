package com.k3ncrypt.storage

import androidx.room.withTransaction
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Runs only after system biometric/device-credential authentication succeeds. */
class LocalVaultGate(private val database: K3ncryptSecureDatabase, private val aead: KeystoreAead) {
    private val mutex = Mutex()
    private val formatNamespace = "vault-format"
    private val formatId = "local"
    private val currentFormat = "authenticated-v2".encodeToByteArray()
    private fun aad(namespace: String, id: String) = "k3ncrypt:android:storage:v1:$namespace:$id".encodeToByteArray()

    suspend fun openAfterSystemAuthentication() = mutex.withLock {
        val marker = database.records().get(formatNamespace, formatId)
        if (marker != null) {
            check(marker.ciphertext.contentEquals(currentFormat)) { "Unsupported local storage format; records were preserved" }
            aead.unlock()
            runCatching { aead.discardLegacyKey() }
            return@withLock
        }

        // The old key is read only inside this one-time migration. All records and the
        // format marker commit together, so a failed migration leaves v1 intact.
        aead.prepareAuthenticatedKey()
        aead.verifyAuthenticatedKey()
        database.withTransaction {
            val records = database.records()
            check(records.get(formatNamespace, formatId) == null) { "Storage migration changed concurrently" }
            records.all().forEach { record ->
                val plain = aead.decryptLegacy(record.ciphertext, aad(record.namespace, record.recordId))
                try {
                    records.put(record.copy(ciphertext = aead.encryptAuthenticated(plain, aad(record.namespace, record.recordId))))
                } finally { plain.fill(0) }
            }
            records.put(SecureRecordEntity(formatNamespace, formatId, currentFormat, System.currentTimeMillis()))
        }
        aead.unlock()
        // Keeping an old, unauthenticated key has no purpose once no records use it.
        runCatching { aead.discardLegacyKey() }
    }
}
