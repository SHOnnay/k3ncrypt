package com.k3ncrypt.network

import com.k3ncrypt.crypto.AccountHandle
import com.k3ncrypt.crypto.CryptoPort
import com.k3ncrypt.crypto.InboundSession
import com.k3ncrypt.crypto.PublicIdentity
import com.k3ncrypt.crypto.SessionHandle
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceLifecycleRequestsTest {
    private val crypto = object : CryptoPort {
        override fun signControlEvent(account: AccountHandle, canonicalPayload: ByteArray) = "test-signature"
        override fun createAccount() = AccountHandle(1); override fun loadAccount(encryptedPickle: String, pickleKey: ByteArray) = AccountHandle(1); override fun saveAccount(account: AccountHandle, pickleKey: ByteArray) = ""; override fun identityKeys(account: AccountHandle) = PublicIdentity("", ""); override fun generateOneTimeKeys(account: AccountHandle, count: Int) {} ; override fun oneTimeKeys(account: AccountHandle) = emptyList<String>(); override fun generateFallbackKey(account: AccountHandle) {} ; override fun fallbackKey(account: AccountHandle) = ""; override fun markKeysAsPublished(account: AccountHandle) {} ; override fun createOutboundSession(account: AccountHandle, recipientIdentityKey: String, recipientPreKey: String) = SessionHandle(1); override fun establishInboundSession(account: AccountHandle, senderIdentityKey: String, preKeyMessage: String) = InboundSession(SessionHandle(1), byteArrayOf()); override fun encrypt(session: SessionHandle, plaintext: ByteArray) = ""; override fun decrypt(session: SessionHandle, wireMessage: String) = byteArrayOf(); override fun saveSession(session: SessionHandle) = byteArrayOf(); override fun loadSession(serialized: ByteArray) = SessionHandle(1); override fun closeAccount(account: AccountHandle) {} ; override fun closeSession(session: SessionHandle) {}
    }
    @Test fun `activation has exact epoch transition fields`() {
        val request = DeviceLifecycleRequests(crypto) { 1_700_000_000_000 }.activationOrRevocation(AccountHandle(1), "event", "account", "issuer", "identity", "target", "targetIdentity", "activate", 7)
        assertTrue(request.canonicalUnsignedJson.contains("\"previousEpoch\":7,\"nextEpoch\":8"))
    }
}
