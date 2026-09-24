package com.k3ncrypt.network

import com.k3ncrypt.security.DeviceAuthorizationProof
import com.k3ncrypt.security.ProofCarrier
import com.k3ncrypt.security.ProofResource
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** TLS REST boundary for signed lifecycle changes and short-lived authorization proofs. */
class K3ncryptApi(baseUrl: String, private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()) {
    @Volatile private var configuredBaseUrl: String? = baseUrl.takeIf(String::isNotBlank)?.let(NetworkEndpoint::validate)

    fun configureBaseUrl(value: String) { configuredBaseUrl = NetworkEndpoint.validate(value) }

    suspend fun bootstrap(signed: SignedControlEvent): JSONObject = postRaw("device-trust/bootstrap", signed.toWireJson())

    suspend fun createChatLink(controlCapabilityHash: String): JSONObject {
        require(controlCapabilityHash.matches(Regex("[a-f0-9]{64}")))
        return execute(Request.Builder().url("${endpoint()}/api/chat-link").post(
            JSONObject().put("controlCapabilityHash", controlCapabilityHash).toString().toRequestBody("application/json".toMediaType()),
        ).build())
    }

    suspend fun enroll(signed: SignedControlEvent, issuerProof: ProofCarrier): JSONObject {
        val body = "{\"event\":${signed.toWireJson()},\"deviceAuthorizationProof\":${proofJson(issuerProof.deviceAuthorizationProof)},\"proofNonce\":${JSONObject.quote(issuerProof.proofNonce)}}"
        return postRaw("device-trust/enrollment", body)
    }

    suspend fun activate(signed: SignedControlEvent): JSONObject = postRaw("device-trust/activation", signed.toWireJson())

    suspend fun revoke(signed: SignedControlEvent, issuerProof: ProofCarrier): JSONObject {
        return postRaw("device-trust/update", "{\"event\":${signed.toWireJson()},\"deviceAuthorizationProof\":${proofJson(issuerProof.deviceAuthorizationProof)}}")
    }

    suspend fun issueProof(request: DeviceProofRequest): ProofCarrier {
        val response = postRaw("device-trust/proof", request.toWireJson())
        val resource = response.optJSONObject("resource")?.let { ProofResource(it.optString("conversationId").takeIf(String::isNotEmpty), it.optString("networkId").takeIf(String::isNotEmpty), it.optString("attachmentId").takeIf(String::isNotEmpty), it.optString("bridgeRouteId").takeIf(String::isNotEmpty)) }
        val proof = DeviceAuthorizationProof(
            version = response.getInt("version"), proofId = response.getString("proofId"),
            accountIdentityReference = response.getString("accountIdentityReference"), deviceId = response.getString("deviceId"),
            deviceIdentityReference = response.getString("deviceIdentityReference"), operation = response.getString("operation"),
            trustEpoch = response.getLong("trustEpoch"), nonce = response.getString("nonce"), resource = resource,
            issuedAt = response.getLong("issuedAt"), expiresAt = response.getLong("expiresAt"), signature = response.getString("signature"),
        )
        return validateIssuedProof(proof, request, System.currentTimeMillis())
    }

    suspend fun publishPrekeys(channelId: String, controlCapability: String, bundle: JSONObject): JSONObject = post(
        "chat-link/${encodePath(channelId)}/prekeys", bundle, mapOf("X-K3ncrypt-Control-Capability" to controlCapability),
    )

    suspend fun fetchPrekeys(channelId: String, controlCapability: String, address: String): JSONObject = get(
        "chat-link/${encodePath(channelId)}/prekeys/${encodePath(address)}", mapOf("X-K3ncrypt-Control-Capability" to controlCapability),
    )

    suspend fun claimPrekey(channelId: String, controlCapability: String, address: String, keyId: String): JSONObject = post(
        "chat-link/${encodePath(channelId)}/prekeys/${encodePath(address)}/claim", JSONObject().put("keyId", keyId), mapOf("X-K3ncrypt-Control-Capability" to controlCapability),
    )

    private suspend fun post(path: String, body: JSONObject, headers: Map<String, String> = emptyMap()): JSONObject = execute(
        Request.Builder().url("${endpoint()}/api/$path").post(body.toString().toRequestBody("application/json".toMediaType())).apply { headers.forEach { (key, value) -> header(key, value) } }.build(),
    )

    private suspend fun postRaw(path: String, body: String): JSONObject = execute(
        Request.Builder().url("${endpoint()}/api/$path").post(body.toRequestBody("application/json".toMediaType())).build(),
    )

    private suspend fun get(path: String, headers: Map<String, String>): JSONObject = execute(
        Request.Builder().url("${endpoint()}/api/$path").get().apply { headers.forEach { (key, value) -> header(key, value) } }.build(),
    )

    private fun endpoint() = configuredBaseUrl ?: error("backend_endpoint_unconfigured")

    private suspend fun execute(request: Request): JSONObject = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, error: java.io.IOException) { if (continuation.isActive) continuation.resumeWith(Result.failure(IllegalStateException("request-failed"))) }
            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) = response.use {
                val text = it.body?.string()
                if (continuation.isActive) {
                    // Preserve only a transport category for callers. Response bodies can
                    // contain server implementation details and must not reach UI state.
                    if (!it.isSuccessful || text.isNullOrBlank()) continuation.resumeWith(Result.failure(IllegalStateException("request-rejected-${it.code}")))
                    else try { continuation.resumeWith(Result.success(JSONObject(text))) } catch (_: Exception) { continuation.resumeWith(Result.failure(IllegalStateException("response-invalid"))) }
                }
            }
        })
    }

    private fun proofJson(proof: DeviceAuthorizationProof): String {
        val resource = proof.resource?.let { r -> linkedMapOf<String, Any?>().apply { r.conversationId?.let { put("conversationId", it) }; r.networkId?.let { put("networkId", it) }; r.attachmentId?.let { put("attachmentId", it) }; r.bridgeRouteId?.let { put("bridgeRouteId", it) } } }
        return CanonicalJson.objectOf(listOf(
            "version" to proof.version, "proofId" to proof.proofId, "accountIdentityReference" to proof.accountIdentityReference,
            "deviceId" to proof.deviceId, "deviceIdentityReference" to proof.deviceIdentityReference, "operation" to proof.operation,
            "trustEpoch" to proof.trustEpoch, "nonce" to proof.nonce, "resource" to resource,
            "issuedAt" to proof.issuedAt, "expiresAt" to proof.expiresAt, "signature" to proof.signature,
        ))
    }

    private fun SignedControlEvent.toWireJson(): String = signedControlWireJson(canonicalUnsignedJson, signature)
    private fun DeviceProofRequest.toWireJson(): String = signedControlWireJson(canonicalUnsignedJson, signature)
    private fun encodePath(value: String) = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")
}
