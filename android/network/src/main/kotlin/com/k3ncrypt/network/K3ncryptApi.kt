package com.k3ncrypt.network

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/** REST boundary. Errors are intentionally collapsed before they reach UI. */
class K3ncryptApi(private val baseUrl: String, private val client: OkHttpClient = OkHttpClient()) {
    suspend fun issueProof(request: DeviceProofRequest): String = kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
        val resource = request.resource?.let { linkedMapOf<String, Any?>().apply { it.conversationId?.let { value -> put("conversationId", value) }; it.networkId?.let { value -> put("networkId", value) }; it.attachmentId?.let { value -> put("attachmentId", value) }; it.bridgeRouteId?.let { value -> put("bridgeRouteId", value) } } }
        val body = CanonicalJson.objectOf(listOf(
            "version" to request.version, "requestId" to request.requestId, "accountIdentityReference" to request.accountIdentityReference,
            "deviceId" to request.deviceId, "deviceIdentityReference" to request.deviceIdentityReference, "operation" to request.operation,
            "nonce" to request.nonce, "epoch" to request.epoch, "resource" to resource, "createdAt" to request.createdAt,
            "expiresAt" to request.expiresAt, "signature" to request.signature,
        ))
        val call = client.newCall(Request.Builder().url("${baseUrl.trimEnd('/')}/api/device-trust/proof").post(body.toRequestBody("application/json".toMediaType())).build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, error: java.io.IOException) { if (continuation.isActive) continuation.resumeWith(Result.failure(IllegalStateException("proof-request-failed"))) }
            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                response.use {
                    if (!it.isSuccessful) {
                        if (continuation.isActive) continuation.resumeWith(Result.failure(IllegalStateException("proof-rejected")))
                    } else {
                        val body = it.body?.string()
                        if (continuation.isActive) {
                            if (body == null) continuation.resumeWith(Result.failure(IllegalStateException("proof-response-empty")))
                            else continuation.resumeWith(Result.success(body))
                        }
                    }
                }
            }
        })
    }
}
