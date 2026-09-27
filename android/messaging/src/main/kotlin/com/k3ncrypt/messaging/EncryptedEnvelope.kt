package com.k3ncrypt.messaging

import org.json.JSONObject

data class EncryptedEnvelope(val olmMessage: String, val isPreKeyMessage: Boolean)

object EncryptedEnvelopeParser {
    fun parse(serialized: String): EncryptedEnvelope {
        val outer = JSONObject(serialized)
        require(outer.keys().asSequence().toSet() == setOf("version", "strategy", "data")) { "Invalid envelope fields" }
        require(outer.getInt("version") == 2 && outer.getString("strategy") == "vodozemac-olm-v1") { "Unsupported envelope" }
        val data = outer.getJSONObject("data")
        require(data.keys().asSequence().toSet() == setOf("version", "olmMessage") && data.getInt("version") == 1) { "Invalid envelope data" }
        val wire = data.getString("olmMessage")
        val isPreKey = runCatching { JSONObject(wire).optInt("message_type", -1) == 0 }.getOrDefault(false)
        return EncryptedEnvelope(wire, isPreKey)
    }
}
