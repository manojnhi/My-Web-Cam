package com.mywebcam.app

import android.util.Size

enum class VideoResolution(val label: String, val size: Size) {
    SD_480P("480p", Size(854, 480)),
    HD_720P("720p", Size(1280, 720)),
    FHD_1080P("1080p", Size(1920, 1080))
}

enum class CameraLens(val label: String) {
    REAR("Rear"),
    FRONT("Front")
}

data class StreamSettings(
    val lens: CameraLens = CameraLens.REAR,
    val resolution: VideoResolution = VideoResolution.HD_720P,
    val frameRate: Int = 30,
    val micEnabled: Boolean = false,
    val localOnly: Boolean = true,
    val remotePassword: String = "",
    val recordLocally: Boolean = false
)

object NetworkGuard {
    fun isLocalNetworkAddress(host: String): Boolean {
        val clean = host.trim().lowercase()
        if (clean == "localhost" || clean == "127.0.0.1" || clean == "::1") return true
        val parts = clean.split(".")
        if (parts.size != 4) return false
        val octets = parts.mapNotNull { it.toIntOrNull() }
        if (octets.size != 4) return false
        val (a, b) = octets[0] to octets[1]
        return a == 10 || a == 127 || (a == 192 && b == 168) || (a == 172 && b in 16..31)
    }

    fun isValidRemotePassword(password: String): Boolean {
        val trimmed = password.trim()
        return trimmed.length >= 6 && trimmed == password
    }
}
