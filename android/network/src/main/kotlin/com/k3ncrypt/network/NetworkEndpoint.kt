package com.k3ncrypt.network

import java.net.URI

/** Allows HTTPS deployments and the Android emulator's explicit host bridge only. */
object NetworkEndpoint {
    fun validate(raw: String): String {
        val value = raw.trim().trimEnd('/')
        require(value.length <= 2048) { "Backend endpoint is too long" }
        val uri = runCatching { URI(value) }.getOrElse { throw IllegalArgumentException("Backend endpoint is invalid") }
        val secure = uri.scheme.equals("https", ignoreCase = true)
        val emulatorHost = uri.scheme.equals("http", ignoreCase = true) && uri.host == "10.0.2.2"
        require((secure || emulatorHost) && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/")) {
            "Use an HTTPS origin, or http://10.0.2.2 for emulator testing."
        }
        return value
    }
}
