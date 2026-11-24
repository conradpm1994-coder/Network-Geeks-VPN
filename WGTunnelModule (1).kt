// Reference implementation (UNTESTED): WireGuard tunnel module for React Native on Android.
// Gradle: implementation("com.wireguard.android:tunnel:<latest>")  and add <service> for GoBackend.VpnService
// (the library's manifest normally merges it). Register WGTunnelPackage in MainApplication.
// With Expo, put this in a config plugin or local module so `expo prebuild` doesn't erase it.
package com.yourcompany.vpn.tunnel

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import java.io.ByteArrayInputStream

class WGTunnelModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), ActivityEventListener {
    private val backend by lazy { GoBackend(ctx.applicationContext) }
    private val tunnel = object : Tunnel {
        override fun getName() = "vpn"
        override fun onStateChange(newState: Tunnel.State) {}
    }
    private var pending: Pair<String, Promise>? = null
    init { ctx.addActivityEventListener(this) }
    override fun getName() = "WGTunnel"

    @ReactMethod fun connect(config: String, name: String, p: Promise) {
        val intent = GoBackend.VpnService.prepare(ctx)
        if (intent != null) { pending = config to p; ctx.currentActivity?.startActivityForResult(intent, 4711); return }
        up(config, p)
    }
    private fun up(config: String, p: Promise) = Thread {
        try {
            backend.setState(tunnel, Tunnel.State.UP, Config.parse(ByteArrayInputStream(config.toByteArray())))
            p.resolve(null)
        } catch (e: Exception) { p.reject("VPN_ERROR", e.message) }
    }.start()

    @ReactMethod fun disconnect(p: Promise) = Thread {
        try { backend.setState(tunnel, Tunnel.State.DOWN, null); p.resolve(null) }
        catch (e: Exception) { p.reject("VPN_ERROR", e.message) }
    }.start()

    @ReactMethod fun isConnected(p: Promise) { p.resolve(backend.getState(tunnel) == Tunnel.State.UP) }

    override fun onActivityResult(a: Activity, req: Int, res: Int, d: Intent?) {
        if (req != 4711) return
        val x = pending ?: return; pending = null
        if (res == Activity.RESULT_OK) up(x.first, x.second) else x.second.reject("DENIED", "VPN permission was denied.")
    }
    override fun onNewIntent(i: Intent) {}
}

class WGTunnelPackage : ReactPackage {
    override fun createNativeModules(c: ReactApplicationContext): List<NativeModule> = listOf(WGTunnelModule(c))
    override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
