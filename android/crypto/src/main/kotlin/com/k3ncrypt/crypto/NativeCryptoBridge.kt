package com.k3ncrypt.crypto

import org.json.JSONArray
import org.json.JSONObject

/**
 * Thin JNI adapter for the Rust Vodozemac authority. Native methods exchange
 * opaque handles and public/encrypted data only; there is no Kotlin crypto.
 */
class NativeCryptoBridge : CryptoPort {
    private companion object {
        init { System.loadLibrary("k3ncrypt_android_crypto") }
    }

    private external fun nativeCreateAccount(): Long
    private external fun nativeLoadAccount(encryptedPickle: String, pickleKey: ByteArray): Long
    private external fun nativeSaveAccount(account: Long, pickleKey: ByteArray): String
    private external fun nativeIdentityKeys(account: Long): String
    private external fun nativeSignControlEvent(account: Long, payload: ByteArray): String
    private external fun nativeGenerateOneTimeKeys(account: Long, count: Int)
    private external fun nativeOneTimeKeys(account: Long): String
    private external fun nativeGenerateFallbackKey(account: Long)
    private external fun nativeFallbackKey(account: Long): String
    private external fun nativeMarkKeysAsPublished(account: Long)
    private external fun nativeCreateOutboundSession(account: Long, identity: String, preKey: String): Long
    private external fun nativeCreateInboundSession(account: Long, senderIdentity: String, message: String): String
    private external fun nativeEncrypt(session: Long, plaintext: ByteArray): String
    private external fun nativeDecrypt(session: Long, wireMessage: String): ByteArray
    private external fun nativeSaveSession(session: Long): ByteArray
    private external fun nativeLoadSession(serialized: ByteArray): Long
    private external fun nativeCloseAccount(account: Long)
    private external fun nativeCloseSession(session: Long)

    override fun createAccount() = AccountHandle(nativeCreateAccount())
    override fun loadAccount(encryptedPickle: String, pickleKey: ByteArray) = AccountHandle(nativeLoadAccount(encryptedPickle, pickleKey))
    override fun saveAccount(account: AccountHandle, pickleKey: ByteArray) = nativeSaveAccount(account.value, pickleKey)
    override fun identityKeys(account: AccountHandle): PublicIdentity = JSONObject(nativeIdentityKeys(account.value)).let { PublicIdentity(it.getString("curve25519"), it.getString("ed25519")) }
    override fun signControlEvent(account: AccountHandle, canonicalPayload: ByteArray) = nativeSignControlEvent(account.value, canonicalPayload)
    override fun generateOneTimeKeys(account: AccountHandle, count: Int) = nativeGenerateOneTimeKeys(account.value, count)
    override fun oneTimeKeys(account: AccountHandle): List<String> = JSONArray(nativeOneTimeKeys(account.value)).let { values -> List(values.length()) { values.getString(it) } }
    override fun generateFallbackKey(account: AccountHandle) = nativeGenerateFallbackKey(account.value)
    override fun fallbackKey(account: AccountHandle) = nativeFallbackKey(account.value)
    override fun markKeysAsPublished(account: AccountHandle) = nativeMarkKeysAsPublished(account.value)
    override fun createOutboundSession(account: AccountHandle, recipientIdentityKey: String, recipientPreKey: String) = SessionHandle(nativeCreateOutboundSession(account.value, recipientIdentityKey, recipientPreKey))
    override fun establishInboundSession(account: AccountHandle, senderIdentityKey: String, preKeyMessage: String): InboundSession {
        val result = JSONObject(nativeCreateInboundSession(account.value, senderIdentityKey, preKeyMessage))
        return InboundSession(SessionHandle(result.getLong("sessionHandle")), android.util.Base64.decode(result.getString("plaintext"), android.util.Base64.NO_WRAP))
    }
    override fun encrypt(session: SessionHandle, plaintext: ByteArray) = nativeEncrypt(session.value, plaintext)
    override fun decrypt(session: SessionHandle, wireMessage: String) = nativeDecrypt(session.value, wireMessage)
    override fun saveSession(session: SessionHandle) = nativeSaveSession(session.value)
    override fun loadSession(serialized: ByteArray) = SessionHandle(nativeLoadSession(serialized))
    override fun closeAccount(account: AccountHandle) = nativeCloseAccount(account.value)
    override fun closeSession(session: SessionHandle) = nativeCloseSession(session.value)
}
