# My Web Cam — Desktop Receiver & Virtual Webcam Project

Cross-platform Electron desktop application + Python `pyvirtualcam` bridge that displays the live Wi-Fi camera stream from your Android phone and exposes it as a selectable virtual webcam for Zoom, Google Meet, Microsoft Teams, and OBS.

## Build Desktop Installers
```bash
cd native/desktop
npm install
npm run start        # Run desktop app in development
npm run dist:win     # Build Windows NSIS installer (.exe) + portable executable
npm run dist:mac     # Build macOS disk image (.dmg)
npm run dist:linux   # Build Linux AppImage & .deb package
```

## Virtual Camera Driver Setup (Required for Zoom / Google Meet)
1. Install Python dependencies:
   ```bash
   pip install -r virtual-cam/requirements.txt
   ```
2. Install the OS virtual camera driver:
   - **Windows**: Install **OBS Studio** (bundles the OBS Virtual Camera driver automatically).
   - **macOS**: Install **OBS Studio 30+** and start Virtual Camera once to authorize the macOS Camera Extension.
   - **Linux**: Install `v4l2loopback-dkms` and load the kernel module:
     ```bash
     sudo modprobe v4l2loopback devices=1 video_nr=2 card_label="My Web Cam" exclusive_caps=1
     ```
3. Click **Enable Virtual Webcam Output** in My Web Cam Desktop (or run `python3 virtual-cam/bridge.py --url ws://<PHONE_IP>:8765`), then select **OBS Virtual Camera** or **My Web Cam** inside Zoom / Google Meet / OBS.
