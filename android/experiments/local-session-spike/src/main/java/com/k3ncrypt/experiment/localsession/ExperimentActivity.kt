package com.k3ncrypt.experiment.localsession

import android.app.Activity
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Standalone debug-only lab UI. It never initializes the normal K3NCRYPT application graph. */
class ExperimentActivity : Activity() {
    private lateinit var controller: SpikeController
    private lateinit var status: TextView
    private lateinit var messageList: TextView
    private lateinit var pairingInput: EditText
    private lateinit var connectionButton: Button
    private lateinit var acceptButton: Button
    private lateinit var stopButton: Button
    private val main by lazy { android.os.Handler(mainLooper) }
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        controller = SpikeController(this) { snapshot -> render(snapshot) }
        buildUi()
        render(controller.snapshot())
    }

    override fun onStart() {
        super.onStart()
        registerNetworkMonitor()
        controller.onNetworkChanged()
    }

    override fun onStop() {
        pairingInput.text?.clear()
        controller.onBackground()
        unregisterNetworkMonitor()
        super.onStop()
    }

    override fun onDestroy() {
        pairingInput.text?.clear()
        controller.dispose()
        super.onDestroy()
    }

    private fun buildUi() {
        val outer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
            setBackgroundColor(0xfff4f5f7.toInt())
        }
        val title = TextView(this).apply {
            text = getString(R.string.experiment_title)
            textSize = 22f
            setTextColor(0xff18212b.toInt())
            setPadding(0, 0, 0, dp(10))
        }
        outer.addView(title)
        val warning = TextView(this).apply {
            text = getString(R.string.experiment_warning)
            textSize = 16f
            setTextColor(0xff7a1c16.toInt())
            setBackgroundColor(0xffffe6e3.toInt())
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        outer.addView(warning, matchWrap())
        status = TextView(this).apply {
            textSize = 15f
            setTextColor(0xff18212b.toInt())
            setPadding(0, dp(14), 0, dp(10))
        }
        outer.addView(status)

        pairingInput = EditText(this).apply {
            hint = getString(R.string.pairing_code_hint)
            contentDescription = getString(R.string.pairing_code_description)
            isSaveEnabled = false
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            filters = arrayOf(InputFilter.LengthFilter(28))
            isSingleLine = true
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        }
        outer.addView(pairingInput, matchWrap())

        addButton(outer, R.string.start_advertiser, R.string.start_advertiser_description) { controller.advertiser() }
        addButton(outer, R.string.start_discovery, R.string.start_discovery_description) { controller.discover() }
        connectionButton = addButton(outer, R.string.connect_endpoint, R.string.connect_endpoint_description) {
            controller.connectSelected(pairingInput.text?.toString().orEmpty())
            pairingInput.text?.clear()
        }
        acceptButton = addButton(outer, R.string.accept_peer, R.string.accept_peer_description) { controller.acceptPeer() }
        stopButton = addButton(outer, R.string.stop_disconnect, R.string.stop_description) {
            pairingInput.text?.clear()
            controller.stop()
        }

        val testHeading = TextView(this).apply {
            text = getString(R.string.fixed_synthetic_messages)
            textSize = 18f
            setTextColor(0xff18212b.toInt())
            setPadding(0, dp(14), 0, dp(4))
        }
        outer.addView(testHeading)
        addButton(outer, R.string.send_ping_a, R.string.send_ping_a) { controller.sendSynthetic("PING-A") }
        addButton(outer, R.string.send_ping_b, R.string.send_ping_b) { controller.sendSynthetic("PING-B") }
        addButton(outer, R.string.send_hello_local_1, R.string.send_hello_local_1) { controller.sendSynthetic("HELLO-LOCAL-1") }
        addButton(outer, R.string.send_hello_local_2, R.string.send_hello_local_2) { controller.sendSynthetic("HELLO-LOCAL-2") }
        messageList = TextView(this).apply {
            text = getString(R.string.empty_messages)
            textSize = 14f
            setTextColor(0xff18212b.toInt())
            setPadding(0, dp(8), 0, dp(12))
        }
        outer.addView(messageList)

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xfff4f5f7.toInt())
        }
        outer.removeView(warning)
        page.addView(warning, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(dp(18), dp(16), dp(18), 0)
        })
        val scroll = ScrollView(this).apply { addView(outer) }
        page.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(page)
    }

    private fun addButton(parent: LinearLayout, visible: Int, description: Int, action: () -> Unit): Button =
        Button(this).apply {
            text = getString(visible)
            contentDescription = getString(description)
            tag = visible
            isAllCaps = false
            setOnClickListener { action() }
            parent.addView(this, matchWrap())
        }

    private fun render(snapshot: Snapshot) {
        if (LooperGuard.notMain()) { main.post { render(snapshot) }; return }
        val profile = controller.networkProfile()
        val wifi = getString(if (profile == null) R.string.wifi_unavailable else R.string.wifi_available)
        val reason = snapshot.reason?.name ?: getString(R.string.none)
        val stateName = snapshot.stage.name.lowercase(java.util.Locale.ROOT).replace('_', ' ')
        val codeLine = snapshot.pairingCode?.let { getString(R.string.pairing_code_display, it) } ?: getString(R.string.pairing_code_not_displayed)
        status.text = getString(
            R.string.network_summary,
            wifi,
            snapshot.internet,
            snapshot.role,
            stateName,
            snapshot.event,
            reason,
            codeLine,
            snapshot.pairingStatus,
            snapshot.encryptionStatus,
        )
        messageList.text = snapshot.messages.takeLast(32).joinToString("\n").ifBlank { getString(R.string.empty_messages) }
        pairingInput.visibility = if (snapshot.role == "discoverer" && snapshot.stage in setOf(Stage.DISCOVERING, Stage.PEER_FOUND, Stage.AUTHENTICATING, Stage.CONNECTING)) View.VISIBLE else View.GONE
        pairingInput.isEnabled = snapshot.stage == Stage.PEER_FOUND
        if (snapshot.secureConnected || snapshot.stage in setOf(Stage.DISCONNECTED, Stage.FAILED)) pairingInput.text?.clear()
        connectionButton.isEnabled = snapshot.stage == Stage.PEER_FOUND
        acceptButton.isEnabled = snapshot.canAccept
        stopButton.isEnabled = snapshot.stage !in setOf(Stage.INACTIVE, Stage.DISCONNECTED, Stage.FAILED)
        (window.decorView as? ViewGroup)?.let { root -> setButtonsEnabled(root, snapshot) }
    }

    private fun setButtonsEnabled(view: View, snapshot: Snapshot) {
        if (view is Button) {
            view.isEnabled = when (view.tag as? Int) {
                R.string.send_ping_a, R.string.send_ping_b, R.string.send_hello_local_1, R.string.send_hello_local_2 -> snapshot.secureConnected
                R.string.start_advertiser, R.string.start_discovery -> snapshot.stage in setOf(Stage.INACTIVE, Stage.DISCONNECTED, Stage.FAILED)
                R.string.connect_endpoint -> snapshot.stage == Stage.PEER_FOUND
                R.string.accept_peer -> snapshot.canAccept
                R.string.stop_disconnect -> snapshot.stage !in setOf(Stage.INACTIVE, Stage.DISCONNECTED, Stage.FAILED)
                else -> view.isEnabled
            }
        }
        if (view is ViewGroup) for (i in 0 until view.childCount) setButtonsEnabled(view.getChildAt(i), snapshot)
    }

    private fun registerNetworkMonitor() {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (networkCallback != null) return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = controller.onNetworkChanged()
            override fun onLost(network: Network) = controller.onNetworkChanged()
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = controller.onNetworkChanged()
        }
        networkCallback = callback
        try {
            manager.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), callback)
        } catch (_: SecurityException) {
            controller.onNetworkChanged()
        }
    }

    private fun unregisterNetworkMonitor() {
        val callback = networkCallback ?: return
        runCatching { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(callback) }
        networkCallback = null
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
}

private object LooperGuard {
    fun notMain() = android.os.Looper.myLooper() != android.os.Looper.getMainLooper()
}
