package com.k3ncrypt.app

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal enum class ContactVerificationState { UNVERIFIED, VERIFIED, IDENTITY_CHANGED_PENDING_REVIEW, UNKNOWN }
internal interface ContactVerificationRecords {
    suspend fun read(contactId: String): ByteArray?
    suspend fun write(contactId: String, bytes: ByteArray)
}

/** Local decision bound to stable conversation and exact identity, never a route or remote claim. */
internal class ContactVerificationAuthority(private val records: ContactVerificationRecords) {
    private val mutex = Mutex()
    private data class Record(val identity: String, val verifiedIdentity: String?, val pendingReview: Boolean)
    private fun valid(value: String) = value.startsWith("K3 ") && value.length in 23..131 && value.none { it.isISOControl() }
    private suspend fun read(id: String): Record? = records.read(id)?.let { bytes ->
        try { require(bytes.size <= 1024)
        DataInputStream(ByteArrayInputStream(bytes)).use {
            require(it.readInt() == 1)
            val identity = it.readUTF()
            val verified = it.readUTF().takeIf(String::isNotEmpty)
            val pending = it.readBoolean()
            require(it.available() == 0 && valid(identity) && (verified == null || valid(verified)))
            require(pending || verified == null || identity == verified)
            Record(identity, verified, pending)
        } } finally { bytes.fill(0) }
    }
    private suspend fun write(id: String, record: Record) {
        val output = ByteArrayOutputStream()
        DataOutputStream(output).use { it.writeInt(1); it.writeUTF(record.identity); it.writeUTF(record.verifiedIdentity ?: ""); it.writeBoolean(record.pendingReview) }
        val bytes = output.toByteArray()
        try { records.write(id, bytes) } finally { bytes.fill(0) }
    }
    suspend fun state(contactId: String, identity: String): ContactVerificationState = mutex.withLock {
        if (contactId.isBlank() || !valid(identity)) return@withLock ContactVerificationState.UNKNOWN
        try {
            val record = read(contactId) ?: return@withLock ContactVerificationState.UNVERIFIED
            when {
                record.identity != identity || record.pendingReview -> ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW
                record.verifiedIdentity == identity -> ContactVerificationState.VERIFIED
                else -> ContactVerificationState.UNVERIFIED
            }
        } catch (_: Exception) { ContactVerificationState.UNKNOWN }
    }
    suspend fun observeIdentity(contactId: String, identity: String, previousIdentity: String? = null) = mutex.withLock {
        require(contactId.isNotBlank() && valid(identity)) { "Contact identity is unavailable" }
        require(previousIdentity == null || valid(previousIdentity))
        val prior = read(contactId) ?: previousIdentity?.let { Record(it, null, false) }
        if (prior == null) write(contactId, Record(identity, null, false))
        else if (prior.identity != identity) write(contactId, Record(identity, prior.verifiedIdentity, true))
    }
    /** Called only after explicit comparison of the exact currently observed identity. */
    suspend fun markVerified(contactId: String, identity: String, confirmedIdentity: String) = mutex.withLock {
        require(valid(identity) && identity == confirmedIdentity) { "Contact fingerprint confirmation did not match" }
        val current = read(contactId) ?: error("Observe the current contact identity before verification")
        require(current.identity == identity) { "Contact identity changed; review it again" }
        write(contactId, Record(identity, identity, false))
    }
    suspend fun markUnverified(contactId: String) = mutex.withLock {
        val current = read(contactId) ?: return@withLock
        write(contactId, current.copy(verifiedIdentity = null))
    }
}

internal fun requireVerifiedCallContact(state: ContactVerificationState) {
    check(state == ContactVerificationState.VERIFIED) { "Verification required: compare and explicitly verify the current contact identity before calling." }
}
