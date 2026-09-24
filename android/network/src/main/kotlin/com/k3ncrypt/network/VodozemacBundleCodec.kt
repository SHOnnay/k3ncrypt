package com.k3ncrypt.network

import com.k3ncrypt.crypto.AccountHandle
import com.k3ncrypt.crypto.CryptoPort
import com.k3ncrypt.crypto.IdentityFingerprint
import com.k3ncrypt.crypto.PublicIdentity
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Base64

data class ClaimedPrekeyBundle(val identity: PublicIdentity, val oneTimeKeyId: String?, val oneTimeKey: String?, val fallbackKey: String?)

object VodozemacBundleCodec {
    /** Converts protocol base64url keys to the standard unpadded base64 alphabet expected by Vodozemac. */
    fun toNativeBase64(value: String): String = IdentityFingerprint.normalize(value)
        .replace('-', '+')
        .replace('_', '/')

    fun publicBundle(crypto: CryptoPort, account: AccountHandle): JSONObject {
        crypto.generateOneTimeKeys(account, 20)
        val identity = crypto.identityKeys(account)
        // Failed publications can leave unpublished keys in the local account.
        // The relay accepts at most 100 keys; publish only that bounded subset.
        val keys = crypto.oneTimeKeys(account).take(100).map { key ->
            val normalized = IdentityFingerprint.normalize(key)
            JSONObject().put("id", keyId(normalized, "otk")).put("key", normalized)
        }
        val fallback = runCatching { crypto.fallbackKey(account) }.getOrElse {
            crypto.generateFallbackKey(account)
            crypto.fallbackKey(account)
        }
        val normalizedFallback = IdentityFingerprint.normalize(fallback)
        val fallbackJson = JSONObject().put("id", keyId(normalizedFallback, "fallback")).put("key", normalizedFallback)
        return JSONObject().put("version", 1).put("protocol", "vodozemac-olm-v1")
            .put("identity", JSONObject().put("curve25519", IdentityFingerprint.normalize(identity.curve25519)).put("ed25519", IdentityFingerprint.normalize(identity.ed25519)))
            .put("oneTimeKeys", org.json.JSONArray(keys)).put("fallbackKey", fallbackJson)
    }

    fun parse(value: JSONObject, expectedIdentityReference: String?): ClaimedPrekeyBundle {
        require(value.getInt("version") == 1 && value.getString("protocol") == "vodozemac-olm-v1")
        val identityJson = value.getJSONObject("identity")
        val identity = PublicIdentity(identityJson.getString("curve25519"), identityJson.getString("ed25519"))
        if (expectedIdentityReference != null) require(IdentityFingerprint.generate(identity) == expectedIdentityReference) { "Remote device identity changed" }
        val oneTimeKeys = value.getJSONArray("oneTimeKeys")
        if (oneTimeKeys.length() > 0) {
            val key = oneTimeKeys.getJSONObject(0)
            require(key.getString("id").matches(Regex("[A-Za-z0-9_-]{8,128}")))
            require(IdentityFingerprint.normalize(key.getString("key")).length == 43)
            return ClaimedPrekeyBundle(identity, key.getString("id"), key.getString("key"), value.optJSONObject("fallbackKey")?.optString("key"))
        }
        val fallback = value.getJSONObject("fallbackKey").getString("key")
        require(IdentityFingerprint.normalize(fallback).length == 43)
        return ClaimedPrekeyBundle(identity, null, null, fallback)
    }

    fun keyId(normalizedKey: String, kind: String): String {
        require(kind == "otk" || kind == "fallback")
        val bytes = MessageDigest.getInstance("SHA-256").digest("k3ncrypt:$kind:v1\u0000$normalizedKey".encodeToByteArray())
        return "$kind-${Base64.getUrlEncoder().withoutPadding().encodeToString(bytes).take(22)}"
    }
}
