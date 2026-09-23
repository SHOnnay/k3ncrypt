package com.k3ncrypt.core

import java.security.MessageDigest
import java.util.Base64

object ByteEncoding {
    fun base64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    fun base64UrlDecode(value: String): ByteArray {
        require(value.matches(Regex("[A-Za-z0-9_-]+"))) { "Invalid base64url" }
        return Base64.getUrlDecoder().decode(value)
    }
    fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
