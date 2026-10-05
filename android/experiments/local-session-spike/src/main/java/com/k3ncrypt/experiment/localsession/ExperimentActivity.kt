package com.k3ncrypt.experiment.localsession

import android.app.Activity
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Standalone debug-only lab UI. It never initializes the normal K3NCRYPT application graph. */
class ExperimentActivity : Activity() {
    private lateinit var controller: SpikeController
    private lateinit var status: TextView
    private lateinit var messageList: TextView
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
        controller.onBackground()
        unregisterNetworkMonitor()
        super.onStop()
    }

    override fun onDestroy() {
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
            text = "EXPERIMENTAL LOCAL SESSION"
            textSize = 22f
            setTextColor(0xff18212b.toInt())
            setPadding(0, 0, 0, dp(10))
        }
        outer.addView(title)
        val warning = TextView(this).apply {
            text = "UNAUTHENTICATED AND UNENCRYPTED\nUse synthetic test data only. Not normal K3NCRYPT messaging.\nAccepted means only that you allowed this experimental connection."
            textSize = 16f
            setTextColor(0xff7a1c16.toInt())
            setBackgroundColor(0xffffe6e3.toInt())
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        outer.addView(warning, matchWrap())
        status = TextView(this).apply {
            textSize = 15f
            setTextColor(0xff18212b.toInt())
            setPadding(0, dp(14), 0, dp(14))
        }
        outer.addView(status)

        addButton(outer, "Start Advertiser", "Start advertiser") { controller.advertiser() }
        addButton(outer, "Start Discovery", "Start discovery") { controller.discover() }
        connectionButton = addButton(outer, "Connect to endpoint 1", "Connect to untrusted test endpoint") { controller.connectSelected() }
        acceptButton = addButton(outer, "Accept Peer", "Accept unverified test connection") { controller.acceptPeer() }
        stopButton = addButton(outer, "Stop / Disconnect", "Stop") { controller.stop() }

        val testHeading = TextView(this).apply {
            text = "Fixed synthetic messages"
            textSize = 18f
            setTextColor(0xff18212b.toInt())
            setPadding(0, dp(14), 0, dp(4))
        }
        outer.addView(testHeading)
        addButton(outer, "Send PING-A", "PING-A") { controller.sendSynthetic("PING-A") }
        addButton(outer, "Send PING-B", "PING-B") { controller.sendSynthetic("PING-B") }
        addButton(outer, "Send HELLO-LOCAL-1", "HELLO-LOCAL-1") { controller.sendSynthetic("HELLO-LOCAL-1") }
        addButton(outer, "Send HELLO-LOCAL-2", "HELLO-LOCAL-2") { controller.sendSynthetic("HELLO-LOCAL-2") }
        messageList = TextView(this).apply {
            text = "No test messages (memory only)."
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

    private fun addButton(parent: LinearLayout, visible: String, description: String, action: () -> Unit): Button =
        Button(this).apply {
            text = visible
            contentDescription = description
            isAllCaps = false
            setOnClickListener { action() }
            parent.addView(this, matchWrap())
        }

    private fun render(snapshot: Snapshot) {
        if (LooperGuard.notMain()) { main.post { render(snapshot) }; return }
        val profile = controller.networkProfile()
        val wifi = if (profile == null) "unavailable / unsupported" else "available (selected Wi-Fi)"
        val reason = snapshot.reason?.name ?: "none"
        status.text = "Network: Wi-Fi $wifi\nInternet required: No\nInternet capability: ${snapshot.internet}\n\nRole: ${snapshot.role}\nState: ${snapshot.stage.name.lowercase().replace('_', ' ')}\nStatus: ${snapshot.event}\nReason: $reason\n\nSession: temporary · memory-only\nAuthentication: NOT PROVIDED\nEncryption: NOT PROVIDED\nTransport: NSD + bounded experimental TCP\nRelay: NOT USED"
        messageList.text = snapshot.messages.takeLast(32).joinToString("\n").ifBlank { "No test messages (memory only)." }
        connectionButton.isEnabled = snapshot.stage == Stage.PEER_FOUND
        acceptButton.isEnabled = snapshot.canAccept
        stopButton.isEnabled = snapshot.stage !in setOf(Stage.INACTIVE, Stage.DISCONNECTED, Stage.FAILED)
        (window.decorView as? ViewGroup)?.let { root -> setButtonsEnabled(root, snapshot) }
    }

    private fun setButtonsEnabled(view: View, snapshot: Snapshot) {
        if (view is Button) {
            val label = view.text.toString()
            view.isEnabled = when {
                label.startsWith("Send ") -> snapshot.connected
                label == "Start Advertiser" || label == "Start Discovery" -> snapshot.stage in setOf(Stage.INACTIVE, Stage.DISCONNECTED, Stage.FAILED)
                view === connectionButton -> snapshot.stage == Stage.PEER_FOUND
                view === acceptButton -> snapshot.canAccept
                view === stopButton -> snapshot.stage !in setOf(Stage.INACTIVE, Stage.DISCONNECTED, Stage.FAILED)
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
