package com.mywebcam.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.text.format.Formatter
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArraySet

class LocalWifiServer(
    private val port: Int = 8765,
    private val settingsProvider: () -> StreamSettings,
    private val onClientCountChanged: (Int) -> Unit,
    private val onServerError: (String) -> Unit
) : WebSocketServer(InetSocketAddress(port)) {

    private val authenticatedClients = CopyOnWriteArraySet<WebSocket>()

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        val settings = settingsProvider()
        val remoteIp = conn.remoteSocketAddress?.address?.hostAddress ?: ""
        val isLocal = NetworkGuard.isLocalNetworkAddress(remoteIp)

        if (settings.localOnly && !isLocal) {
            conn.close(4003, "Local Wi-Fi only mode enabled")
            return
        }

        if (!settings.localOnly && !isLocal) {
            val supplied = handshake.getFieldValue("X-Webcam-Password")
            if (supplied != settings.remotePassword || settings.remotePassword.isEmpty()) {
                conn.close(4001, "Valid remote password required")
                return
            }
        }

        authenticatedClients.add(conn)
        onClientCountChanged(authenticatedClients.size)
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
        authenticatedClients.remove(conn)
        onClientCountChanged(authenticatedClients.size)
    }

    override fun onMessage(conn: WebSocket, message: String) {
        // Control ping/pong or camera configuration ack
        if (message == "ping") {
            conn.send("pong")
        }
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        onServerError(ex.message ?: "Wi-Fi stream socket interrupted")
    }

    override fun onStart() {
        connectionLostTimeout = 10
    }

    fun broadcastJpegFrame(jpegBytes: ByteArray) {
        if (authenticatedClients.isEmpty()) return
        val buffer = ByteBuffer.wrap(jpegBytes)
        for (client in authenticatedClients) {
            if (client.isOpen) {
                client.send(buffer.duplicate())
            }
        }
    }

    fun broadcastPcmAudio(pcmBytes: ByteArray) {
        if (authenticatedClients.isEmpty()) return
        val packet = ByteArray(pcmBytes.size + 1)
        packet[0] = 0x02 // Audio frame tag (0x01 = video, 0x02 = PCM audio)
        System.arraycopy(pcmBytes, 0, packet, 1, pcmBytes.size)
        for (client in authenticatedClients) {
            if (client.isOpen) {
                client.send(packet)
            }
        }
    }

    companion object {
        @Suppress("DEPRECATION")
        fun getLocalWifiIp(context: Context): String {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val ipInt = wifiManager.connectionInfo.ipAddress
            return if (ipInt != 0) Formatter.formatIpAddress(ipInt) else "127.0.0.1"
        }

        fun registerWifiMonitor(
            context: Context,
            onWifiAvailable: () -> Unit,
            onWifiLost: () -> Unit
        ): ConnectivityManager.NetworkCallback {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val request = NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .build()
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) = onWifiAvailable()
                override fun onLost(network: Network) = onWifiLost()
            }
            cm.registerNetworkCallback(request, callback)
            return callback
        }
    }
}
