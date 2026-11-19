# My Web Cam — Android Source Project

Native Kotlin + Jetpack Compose + CameraX Android application that turns your phone into a Wi-Fi camera and virtual webcam source.

## Features
- **On-Demand Permissions**: Camera and Microphone permissions are only requested when you tap **Start Camera Stream** or enable **Microphone Audio Stream**.
- **Camera Controls**: Switch between Rear and Front cameras, choose `480p` / `720p` / `1080p`, and target `15` / `24` / `30` / `60` fps.
- **QR & URL Pairing**: Displays your local Wi-Fi socket address and QR code for instant desktop pairing.
- **Local-Network-Only Default**: Blocks non-LAN IP addresses unless **Remote Access** is explicitly enabled with a 6+ character password.
- **Zero Auto-Recording**: Video is streamed live and never written to disk unless the user explicitly records a clip.

## Build the Installable APK
### Option 1: Android Studio
1. Open `native/android` in Android Studio (Ladybug or newer).
2. Let Gradle sync dependencies (SDK 35, JDK 17).
3. Click **Build > Build Bundle(s) / APK(s) > Build APK(s)**, or run directly on a USB-debugging phone.

### Option 2: Command Line
```bash
cd native/android
chmod +x build-apk.sh
./build-apk.sh
```
Install on your phone via ADB:
```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
