"""
My Web Cam — Cross-Platform Virtual Webcam Bridge
Connects to the Android phone's Wi-Fi WebSocket stream (or the local My Web Cam
relay) and outputs frames to a system-wide virtual webcam device so Zoom,
Google Meet, Microsoft Teams, and OBS can select it as a camera.

Platform drivers required:
- Windows: OBS Studio (includes OBS Virtual Camera driver)
- macOS:   OBS Studio 30+ (CoreMediaIO virtual camera extension)
- Linux:   v4l2loopback kernel module (`sudo modprobe v4l2loopback devices=1 card_label="My Web Cam"`)
"""

import argparse
import asyncio
import sys
import cv2
import numpy as np
import pyvirtualcam
import websockets


async def stream_to_virtual_cam(url: str, password: str | None, width: int, height: int, fps: int) -> None:
    headers = {}
    if password:
        headers["X-Webcam-Password"] = password

    print(f"[My Web Cam] Connecting to {url} ...", flush=True)
    async with websockets.connect(url, additional_headers=headers, max_size=8 * 1024 * 1024) as ws:
        with pyvirtualcam.Camera(width=width, height=height, fps=fps, fmt=pyvirtualcam.PixelFormat.RGB) as cam:
            print(f"[My Web Cam] Virtual webcam active on device: {cam.device}", flush=True)
            async for message in ws:
                if isinstance(message, (bytes, bytearray)) and len(message) > 1 and message[0] == 0x01:
                    jpg = np.frombuffer(message[1:], dtype=np.uint8)
                    bgr = cv2.imdecode(jpg, cv2.IMREAD_COLOR)
                    if bgr is None:
                        continue
                    if bgr.shape[1] != width or bgr.shape[0] != height:
                        bgr = cv2.resize(bgr, (width, height))
                    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                    cam.send(rgb)
                    cam.sleep_until_next_frame()


def main() -> None:
    parser = argparse.ArgumentParser(description="My Web Cam Virtual Camera Bridge")
    parser.add_argument("--url", required=True, help="WebSocket stream URL, e.g. ws://192.168.1.42:8765")
    parser.add_argument("--password", default=None, help="Remote access password if connecting outside local Wi-Fi")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--fps", type=int, default=30)
    args = parser.parse_args()

    try:
        asyncio.run(stream_to_virtual_cam(args.url, args.password, args.width, args.height, args.fps))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
