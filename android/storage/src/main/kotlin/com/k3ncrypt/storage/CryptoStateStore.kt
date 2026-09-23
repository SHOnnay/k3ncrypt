package com.k3ncrypt.storage

import androidx.room.withTransaction

data class SessionState(val sessionId: String, val pickle: ByteArray)
data class LifecycleMetadata(val accountReference: String, val deviceId: String, val identityReference: String, val epoch: Long, val state: String)

/**
 * Equivalent to the browser prepared/account-written/committed transaction.
 * A message is not eligible for mailbox acceptance until this method returns.
 */
class CryptoStateStore(private val database: K3ncryptSecureDatabase, private val aead: KeystoreAead, private val now: () -> Long = { System.currentTimeMillis() }) {
    private fun seal(namespace: String, id: String, bytes: ByteArray): SecureRecordEntity = SecureRecordEntity(namespace, id, aead.encrypt(bytes, "k3ncrypt:android:storage:v1:$namespace:$id".encodeToByteArray()), now())
    suspend fun commitAccountAndSession(accountId: String, accountPickle: String, session: SessionState) {
        database.withTransaction {
            val records = database.records()
            records.put(seal("commit", accountId, "prepared:${session.sessionId}".encodeToByteArray()))
            records.put(seal("account", accountId, accountPickle.encodeToByteArray()))
            records.put(seal("commit", accountId, "account-written:${session.sessionId}".encodeToByteArray()))
            records.put(seal("session", session.sessionId, session.pickle))
            records.put(seal("commit", accountId, "committed:${session.sessionId}".encodeToByteArray()))
        }
    }
    suspend fun persistLifecycle(metadata: LifecycleMetadata) {
        val text = listOf(metadata.accountReference, metadata.deviceId, metadata.identityReference, metadata.epoch.toString(), metadata.state).joinToString("\u0000")
        database.records().put(seal("lifecycle", metadata.deviceId, text.encodeToByteArray()))
    }
    suspend fun consumeReplay(namespace: String, key: String) {
        database.withTransaction {
            check(database.records().get("replay:$namespace", key) == null) { "Replay detected" }
            database.records().put(seal("replay:$namespace", key, "consumed".encodeToByteArray()))
        }
    }
}
