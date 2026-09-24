package com.k3ncrypt.storage

import androidx.room.withTransaction
import org.json.JSONObject

data class SessionState(val sessionId: String, val pickle: ByteArray)
data class LifecycleMetadata(val accountReference: String, val deviceId: String, val identityReference: String, val epoch: Long, val state: String)
data class StoredMessage(val deliveryId: String, val conversationId: String, val senderRoutingId: String, val text: String, val receivedAt: Long)
data class StoredOutboundMessage(val clientMessageId: String, val conversationId: String, val senderRoutingId: String, val peerRoutingId: String, val text: String, val createdAt: Long)
enum class InboundCommitResult { STORED, DUPLICATE }

/** Encrypted Room adapter. Security state, message bytes, and dedupe markers commit together. */
class CryptoStateStore(private val database: K3ncryptSecureDatabase, private val aead: KeystoreAead, private val now: () -> Long = { System.currentTimeMillis() }) {
    private fun aad(namespace: String, id: String) = "k3ncrypt:android:storage:v1:$namespace:$id".encodeToByteArray()
    private fun seal(namespace: String, id: String, bytes: ByteArray): SecureRecordEntity = SecureRecordEntity(namespace, id, aead.encrypt(bytes, aad(namespace, id)), now())
    private fun open(record: SecureRecordEntity): ByteArray = aead.decrypt(record.ciphertext, aad(record.namespace, record.recordId))

    suspend fun read(namespace: String, id: String): ByteArray? = database.records().get(namespace, id)?.let(::open)
    suspend fun list(namespace: String): List<Pair<String, ByteArray>> = database.records().list(namespace).map { it.recordId to open(it) }
    suspend fun write(namespace: String, id: String, bytes: ByteArray) { database.records().put(seal(namespace, id, bytes)) }
    suspend fun hasInboundDigest(digest: String): Boolean = database.records().get("inbound-digest", digest) != null

    suspend fun commitAccountAndSession(accountId: String, accountPickle: String, session: SessionState) {
        database.withTransaction {
            val records = database.records()
            records.put(seal("account", accountId, accountPickle.encodeToByteArray()))
            records.put(seal("session", session.sessionId, session.pickle))
        }
    }

    suspend fun persistAccount(accountId: String, accountPickle: String) {
        database.withTransaction { database.records().put(seal("account", accountId, accountPickle.encodeToByteArray())) }
    }

    suspend fun persistIdentityCheckpoint(accountId: String, accountPickle: String, checkpoint: ByteArray) {
        database.withTransaction {
            val records = database.records()
            records.put(seal("account", accountId, accountPickle.encodeToByteArray()))
            records.put(seal("identity-checkpoint", "local", checkpoint))
        }
    }

    suspend fun readIdentityCheckpoint(): ByteArray? = read("identity-checkpoint", "local")

    /** Returns DUPLICATE without ratchet/state writes when the same envelope was committed before. */
    suspend fun commitInbound(accountId: String, accountPickle: String, session: SessionState, digest: String, message: StoredMessage): InboundCommitResult = database.withTransaction {
        val records = database.records()
        val prior = records.get("inbound-digest", digest)
        if (prior != null) return@withTransaction InboundCommitResult.DUPLICATE
        val deliveryPrior = records.get("inbound-delivery", message.deliveryId)
        check(deliveryPrior == null) { "Mailbox delivery identifier conflicts with stored state" }
        val encodedMessage = JSONObject()
            .put("deliveryId", message.deliveryId)
            .put("conversationId", message.conversationId)
            .put("senderRoutingId", message.senderRoutingId)
            .put("text", message.text)
            .put("receivedAt", message.receivedAt)
            .toString().encodeToByteArray()
        records.put(seal("commit", accountId, "committed:${message.deliveryId}".encodeToByteArray()))
        records.put(seal("account", accountId, accountPickle.encodeToByteArray()))
        records.put(seal("session", session.sessionId, session.pickle))
        records.put(seal("message", message.deliveryId, encodedMessage))
        records.put(seal("inbound-digest", digest, message.deliveryId.encodeToByteArray()))
        records.put(seal("inbound-delivery", message.deliveryId, digest.encodeToByteArray()))
        InboundCommitResult.STORED
    }

    suspend fun commitOutbound(accountId: String, accountPickle: String, session: SessionState, clientMessageId: String, encryptedEnvelope: String, message: StoredOutboundMessage) {
        database.withTransaction {
            val records = database.records()
            check(records.get("outbox", clientMessageId) == null) { "Duplicate outbound message identifier" }
            records.put(seal("account", accountId, accountPickle.encodeToByteArray()))
            records.put(seal("session", session.sessionId, session.pickle))
            records.put(seal("outbox", clientMessageId, JSONObject().put("conversationId", message.conversationId).put("peerRoutingId", message.peerRoutingId).put("envelope", encryptedEnvelope).toString().encodeToByteArray()))
            records.put(seal("outbound-message", clientMessageId, JSONObject().put("clientMessageId", clientMessageId).put("conversationId", message.conversationId).put("senderRoutingId", message.senderRoutingId).put("peerRoutingId", message.peerRoutingId).put("text", message.text).put("createdAt", message.createdAt).toString().encodeToByteArray()))
        }
    }

    suspend fun messages(): List<StoredMessage> {
        val inbound = database.records().list("message").map { record ->
        val json = JSONObject(open(record).decodeToString())
        StoredMessage(json.getString("deliveryId"), json.getString("conversationId"), json.getString("senderRoutingId"), json.getString("text"), json.getLong("receivedAt"))
        }
        val outbound = database.records().list("outbound-message").map { record ->
            val json = JSONObject(open(record).decodeToString())
            StoredMessage(json.getString("clientMessageId"), json.getString("conversationId"), json.getString("senderRoutingId"), json.getString("text"), json.getLong("createdAt"))
        }
        return (inbound + outbound).sortedBy { it.receivedAt }
    }

    suspend fun sessions(): List<Pair<String, ByteArray>> = database.records().list("session").map { it.recordId to open(it) }
    suspend fun pendingOutbox(): List<Pair<String, String>> = database.records().list("outbox").map { it.recordId to open(it).decodeToString() }
    suspend fun acknowledgeOutbound(clientMessageId: String) {
        database.withTransaction {
            database.records().remove("outbox", clientMessageId)
        }
    }

    suspend fun persistLifecycle(metadata: LifecycleMetadata) {
        val json = JSONObject().put("accountReference", metadata.accountReference).put("deviceId", metadata.deviceId)
            .put("identityReference", metadata.identityReference).put("epoch", metadata.epoch).put("state", metadata.state).toString()
        database.records().put(seal("lifecycle", "local", json.encodeToByteArray()))
    }

    suspend fun readLifecycle(): LifecycleMetadata? = read("lifecycle", "local")?.let { bytes ->
        val json = JSONObject(bytes.decodeToString())
        LifecycleMetadata(json.getString("accountReference"), json.getString("deviceId"), json.getString("identityReference"), json.getLong("epoch"), json.getString("state"))
    }

    suspend fun consumeReplay(namespace: String, key: String) {
        database.withTransaction {
            val id = "$namespace:$key"
            check(database.records().get("replay", id) == null) { "Replay detected" }
            database.records().put(seal("replay", id, "consumed".encodeToByteArray()))
        }
    }
}
