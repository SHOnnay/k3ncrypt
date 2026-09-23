package com.k3ncrypt.crypto

/** Opaque native references. Kotlin never receives private identity material. */
@JvmInline value class AccountHandle(val value: Long)
@JvmInline value class SessionHandle(val value: Long)

data class PublicIdentity(val curve25519: String, val ed25519: String)
data class InboundSession(val session: SessionHandle, val plaintext: ByteArray)

interface CryptoPort {
    fun createAccount(): AccountHandle
    fun loadAccount(encryptedPickle: String, pickleKey: ByteArray): AccountHandle
    fun saveAccount(account: AccountHandle, pickleKey: ByteArray): String
    fun identityKeys(account: AccountHandle): PublicIdentity
    fun signControlEvent(account: AccountHandle, canonicalPayload: ByteArray): String
    fun generateOneTimeKeys(account: AccountHandle, count: Int)
    fun oneTimeKeys(account: AccountHandle): List<String>
    fun generateFallbackKey(account: AccountHandle)
    fun fallbackKey(account: AccountHandle): String
    fun markKeysAsPublished(account: AccountHandle)
    fun createOutboundSession(account: AccountHandle, recipientIdentityKey: String, recipientPreKey: String): SessionHandle
    fun establishInboundSession(account: AccountHandle, senderIdentityKey: String, preKeyMessage: String): InboundSession
    fun encrypt(session: SessionHandle, plaintext: ByteArray): String
    fun decrypt(session: SessionHandle, wireMessage: String): ByteArray
    fun saveSession(session: SessionHandle): ByteArray
    fun loadSession(serialized: ByteArray): SessionHandle
    fun closeAccount(account: AccountHandle)
    fun closeSession(session: SessionHandle)
}
