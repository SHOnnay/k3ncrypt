package com.k3ncrypt.storage

import java.security.SecureRandom

/** The random Vodozemac pickle key is stored only as an AEAD-sealed Keystore record. */
class PickleKeyVault(private val records: EncryptedRecordStore, private val random: SecureRandom = SecureRandom()) {
    suspend fun create(accountId: String): ByteArray {
        require(records.get("pickle-key", accountId) == null) { "Pickle key already exists" }
        val key = ByteArray(32).also(random::nextBytes)
        try { records.put("pickle-key", accountId, key) } catch (error: Throwable) { key.fill(0); throw error }
        return key
    }

    suspend fun load(accountId: String): ByteArray = records.get("pickle-key", accountId)
        ?.also { require(it.size == 32) { "Stored account key is invalid" } }
        ?: throw IllegalStateException("Stored account key is unavailable")
}
