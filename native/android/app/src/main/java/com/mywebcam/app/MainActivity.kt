package com.mywebcam.app

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Bundle
import android.util.Range
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                MyWebCamScreen()
            }
        }
    }
}

@Composable
fun MyWebCamScreen() {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    var settings by remember { mutableStateOf(StreamSettings()) }
    var isStreaming by remember { mutableStateOf(false) }
    var wifiConnected by remember { mutableStateOf(true) }
    var clientCount by remember { mutableIntStateOf(0) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showPasswordDialog by remember { mutableStateOf(false) }
    var pendingPassword by remember { mutableStateOf("") }
    var passwordError by remember { mutableStateOf<String?>(null) }

    val localIp = remember(wifiConnected) { LocalWifiServer.getLocalWifiIp(context) }
    val pairingUrl = remember(localIp) { "ws://$localIp:8765" }
    val qrBitmap = remember(pairingUrl) { QrCodeGenerator.createBitmap(pairingUrl, 360) }

    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }
    var server by remember { mutableStateOf<LocalWifiServer?>(null) }
    var audioThreadRunning by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        val callback = LocalWifiServer.registerWifiMonitor(
            context = context,
            onWifiAvailable = { wifiConnected = true },
            onWifiLost = {
                wifiConnected = false
                errorMessage = "Wi-Fi disconnected. Waiting to reconnect on local network..."
            }
        )
        onDispose {
            server?.stop()
            cameraExecutor.shutdown()
            val cm = context.getSystemService(android.content.Context.CONNECTIVITY_SERVICE)
                as android.net.ConnectivityManager
            cm.unregisterNetworkCallback(callback)
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val cameraOk = grants[Manifest.permission.CAMERA] == true ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        if (!cameraOk) {
            errorMessage = "Camera permission is required to start streaming."
            return@rememberLauncherForActivityResult
        }
        if (settings.micEnabled &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) {
            settings = settings.copy(micEnabled = false)
            errorMessage = "Microphone permission denied; streaming video only."
        }
        errorMessage = null
        isStreaming = true
    }

    LaunchedEffect(isStreaming) {
        if (isStreaming) {
            try {
                val wsServer = LocalWifiServer(
                    port = 8765,
                    settingsProvider = { settings },
                    onClientCountChanged = { clientCount = it },
                    onServerError = { errorMessage = it }
                )
                wsServer.start()
                server = wsServer
            } catch (e: Exception) {
                errorMessage = e.message ?: "Unable to bind Wi-Fi streaming port 8765."
                isStreaming = false
            }
        } else {
            audioThreadRunning = false
            server?.stop()
            server = null
            clientCount = 0
        }
    }

    LaunchedEffect(isStreaming, settings.micEnabled) {
        if (isStreaming && settings.micEnabled &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        ) {
            audioThreadRunning = true
            thread(start = true) {
                val sampleRate = 16000
                val minBuf = AudioRecord.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                )
                val recorder = AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    minBuf
                )
                val buffer = ByteArray(minBuf)
                recorder.startRecording()
                try {
                    while (audioThreadRunning && isStreaming && settings.micEnabled) {
                        val read = recorder.read(buffer, 0, buffer.size)
                        if (read > 0) {
                            server?.broadcastPcmAudio(buffer.copyOf(read))
                        }
                    }
                } finally {
                    recorder.stop()
                    recorder.release()
                }
            }
        } else {
            audioThreadRunning = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF8FAFC))
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "My Web Cam",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF0F172A)
        )

        Text(
            text = when {
                !wifiConnected -> "Status: Reconnecting to Wi-Fi..."
                isStreaming && clientCount > 0 -> "Status: Streaming live · $clientCount desktop connected"
                isStreaming -> "Status: Ready on Wi-Fi · Waiting for desktop"
                else -> "Status: Idle · Camera off (not recording)"
            },
            style = MaterialTheme.typography.bodyMedium,
            color = if (wifiConnected) Color(0xFF334155) else Color(0xFFD97706)
        )

        errorMessage?.let { msg ->
            Surface(
                color = Color(0xFFFEF2F2),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = msg,
                    color = Color(0xFFB91C1C),
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }

        // Camera preview only initializes after user starts streaming and grants permission
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(240.dp)
                .background(Color(0xFF0B0F19), RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center
        ) {
            if (isStreaming) {
                CameraPreviewSurface(
                    settings = settings,
                    lifecycleOwner = lifecycleOwner,
                    executor = cameraExecutor,
                    onJpegFrame = { bytes ->
                        val packet = ByteArray(bytes.size + 1)
                        packet[0] = 0x01 // Video JPEG frame
                        System.arraycopy(bytes, 0, packet, 1, bytes.size)
                        server?.broadcastJpegFrame(packet)
                    },
                    onError = { msg -> errorMessage = msg }
                )
            } else {
                Text(
                    text = "Tap Start Camera Stream to request camera access",
                    color = Color(0xFF94A3B8),
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }

        Button(
            onClick = {
                if (isStreaming) {
                    isStreaming = false
                } else {
                    val needed = mutableListOf<String>()
                    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        needed.add(Manifest.permission.CAMERA)
                    }
                    if (settings.micEnabled &&
                        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
                    ) {
                        needed.add(Manifest.permission.RECORD_AUDIO)
                    }
                    if (needed.isEmpty()) {
                        errorMessage = null
                        isStreaming = true
                    } else {
                        permissionLauncher.launch(needed.toTypedArray())
                    }
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = if (isStreaming) Color(0xFFDC2626) else Color(0xFF2563EB)
            )
        ) {
            Text(if (isStreaming) "Stop Camera Stream" else "Start Camera Stream")
        }

        // Camera controls
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = Color.White,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Camera Controls", fontWeight = FontWeight.SemiBold)

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CameraLens.entries.forEach { lens ->
                        FilterChip(
                            selected = settings.lens == lens,
                            onClick = { settings = settings.copy(lens = lens) },
                            label = { Text("${lens.label} Camera") }
                        )
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    VideoResolution.entries.forEach { res ->
                        FilterChip(
                            selected = settings.resolution == res,
                            onClick = { settings = settings.copy(resolution = res) },
                            label = { Text(res.label) }
                        )
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(15, 24, 30, 60).forEach { fps ->
                        FilterChip(
                            selected = settings.frameRate == fps,
                            onClick = { settings = settings.copy(frameRate = fps) },
                            label = { Text("$fps fps") }
                        )
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Microphone Audio Stream")
                    Switch(
                        checked = settings.micEnabled,
                        onCheckedChange = { enabled ->
                            if (enabled && ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                                settings = settings.copy(micEnabled = true)
                                if (isStreaming) {
                                    permissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
                                }
                            } else {
                                settings = settings.copy(micEnabled = enabled)
                            }
                        }
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Network Access")
                        Text(
                            if (settings.localOnly) "Local Wi-Fi Only (Default)" else "Password-Protected Remote Access",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF64748B)
                        )
                    }
                    Switch(
                        checked = !settings.localOnly,
                        onCheckedChange = { wantRemote ->
                            if (wantRemote) {
                                showPasswordDialog = true
                            } else {
                                settings = settings.copy(localOnly = true, remotePassword = "")
                            }
                        }
                    )
                }
            }
        }

        // Pairing URL & QR Code
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = Color.White,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text("Pair Desktop Receiver", fontWeight = FontWeight.SemiBold)
                Image(
                    bitmap = qrBitmap.asImageBitmap(),
                    contentDescription = "QR code for pairing URL $pairingUrl",
                    modifier = Modifier.size(160.dp)
                )
                Text(pairingUrl, color = Color(0xFF2563EB), fontWeight = FontWeight.Medium)
                Text(
                    "Connect both phone and computer to the same Wi-Fi network, then enter this URL or scan the QR code in the My Web Cam desktop app.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF64748B)
                )
            }
        }
    }

    if (showPasswordDialog) {
        AlertDialog(
            onDismissRequest = { showPasswordDialog = false },
            title = { Text("Require Remote Password") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Set a password (minimum 6 characters) before allowing connections outside your local Wi-Fi.")
                    OutlinedTextField(
                        value = pendingPassword,
                        onValueChange = { pendingPassword = it },
                        label = { Text("Remote Access Password") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true
                    )
                    passwordError?.let {
                        Text(it, color = Color(0xFFDC2626), style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (NetworkGuard.isValidRemotePassword(pendingPassword)) {
                        settings = settings.copy(localOnly = false, remotePassword = pendingPassword)
                        passwordError = null
                        pendingPassword = ""
                        showPasswordDialog = false
                    } else {
                        passwordError = "Password must be at least 6 characters with no leading/trailing spaces."
                    }
                }) {
                    Text("Enable Remote Access")
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    passwordError = null
                    showPasswordDialog = false
                }) { Text("Cancel") }
            }
        )
    }
}

@Composable
@Suppress("OPT_IN_USAGE")
private fun CameraPreviewSurface(
    settings: StreamSettings,
    lifecycleOwner: androidx.lifecycle.LifecycleOwner,
    executor: java.util.concurrent.ExecutorService,
    onJpegFrame: (ByteArray) -> Unit,
    onError: (String) -> Unit
) {
    val context = LocalContext.current
    val previewView = remember { PreviewView(context) }

    LaunchedEffect(settings.lens, settings.resolution, settings.frameRate) {
        try {
            val cameraProvider = ProcessCameraProvider.getInstance(context).get()
            cameraProvider.unbindAll()

            val selector = if (settings.lens == CameraLens.FRONT) {
                CameraSelector.DEFAULT_FRONT_CAMERA
            } else {
                CameraSelector.DEFAULT_BACK_CAMERA
            }

            val resolutionSelector = ResolutionSelector.Builder()
                .setResolutionStrategy(
                    ResolutionStrategy(
                        settings.resolution.size,
                        ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                    )
                )
                .build()

            val previewBuilder = Preview.Builder().setResolutionSelector(resolutionSelector)
            Camera2Interop.Extender(previewBuilder).setCaptureRequestOption(
                android.hardware.camera2.CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
                Range(settings.frameRate, settings.frameRate)
            )
            val preview = previewBuilder.build().also {
                it.surfaceProvider = previewView.surfaceProvider
            }

            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(resolutionSelector)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()

            analysis.setAnalyzer(executor) { image ->
                try {
                    val jpeg = imageProxyToJpeg(image)
                    onJpegFrame(jpeg)
                } catch (e: Exception) {
                    onError("Frame capture interrupted: ${e.message}")
                } finally {
                    image.close()
                }
            }

            cameraProvider.bindToLifecycle(lifecycleOwner, selector, preview, analysis)
        } catch (e: Exception) {
            onError("Camera unavailable: ${e.localizedMessage ?: "hardware error"}")
        }
    }

    AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
}

private fun imageProxyToJpeg(image: ImageProxy): ByteArray {
    val yBuffer = image.planes[0].buffer
    val uBuffer = image.planes[1].buffer
    val vBuffer = image.planes[2].buffer
    val ySize = yBuffer.remaining()
    val uSize = uBuffer.remaining()
    val vSize = vBuffer.remaining()
    val nv21 = ByteArray(ySize + uSize + vSize)
    yBuffer.get(nv21, 0, ySize)
    vBuffer.get(nv21, ySize, vSize)
    uBuffer.get(nv21, ySize + vSize, uSize)
    val yuv = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
    val out = ByteArrayOutputStream()
    yuv.compressToJpeg(Rect(0, 0, image.width, image.height), 80, out)
    return out.toByteArray()
}
