package com.k3ncrypt.network

import org.json.JSONObject

/** Fixed-order compact JSON for Phase 8 signed request compatibility. */
object CanonicalJson {
    fun objectOf(fields: List<Pair<String, Any?>>): String = buildString {
        append('{')
        fields.filter { it.second != null }.forEachIndexed { index, (name, value) ->
            if (index > 0) append(',')
            append(JSONObject.quote(name)).append(':').append(encode(value!!))
        }
        append('}')
    }
    private fun encode(value: Any): String = when (value) {
        is String -> JSONObject.quote(value)
        is Number, is Boolean -> value.toString()
        is Map<*, *> -> objectOf(value.entries.map { require(it.key is String); it.key as String to it.value })
        is List<*> -> value.joinToString(prefix = "[", postfix = "]") { encode(it ?: error("null array values are not supported in signed requests")) }
        else -> error("Unsupported canonical JSON value")
    }
}
