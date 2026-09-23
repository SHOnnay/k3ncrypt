package com.k3ncrypt.crypto

import com.k3ncrypt.core.ByteEncoding
import java.util.Locale

object IdentityFingerprint {
    fun generate(identity: PublicIdentity): String {
        val curve = normalize(identity.curve25519)
        val ed = normalize(identity.ed25519)
        val digest = ByteEncoding.base64Url(java.security.MessageDigest.getInstance("SHA-256").digest("k3ncrypt:vodozemac-identity:v1\u0000$curve\u0000$ed".encodeToByteArray())).uppercase(Locale.ROOT)
        return "K3 " + digest.chunked(4).joinToString(" ")
    }
    fun normalize(value: String): String {
        val base64Url = value.replace('+', '-').replace('/', '_').trimEnd('=')
        return ByteEncoding.base64Url(java.util.Base64.getUrlDecoder().decode(base64Url.padEnd((base64Url.length + 3) / 4 * 4, '=')))
    }
}
