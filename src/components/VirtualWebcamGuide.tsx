import { useState } from 'react';
import { Check, Copy, Download, ExternalLink, Monitor, Video } from 'lucide-react';
import { buildPairingUrl } from '../utils/streamConfig';

interface VirtualWebcamGuideProps {
  roomId: string;
}

type PlatformKey = 'windows' | 'macos' | 'linux' | 'obs-browser';

export function VirtualWebcamGuide({ roomId }: VirtualWebcamGuideProps) {
  const [platform, setPlatform] = useState<PlatformKey>('windows');
  const [copiedFeed, setCopiedFeed] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const feedUrl = buildPairingUrl(origin, roomId, 'feed');

  const copyFeedUrl = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopiedFeed(true);
      setTimeout(() => setCopiedFeed(false), 2000);
    } catch {
      // Clipboard blocked in restricted contexts
    }
  };

  return (
    <section className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 text-balance">
            Use My Web Cam in Zoom, Google Meet, and OBS
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-600">
            Web browsers cannot register a system-wide virtual camera hardware device on their own.
            Pair the clean feed or the My Web Cam Desktop Bridge with a platform virtual camera driver
            so video conferencing apps list your phone as a selectable webcam.
          </p>
        </div>
        <a
          href="/api/download/virtual-cam-bridge.py"
          download="my_web_cam_virtual_bridge.py"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" />
          Download Python Bridge
        </a>
      </div>

      {/* Zero-Driver OBS Browser Source Card */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Clean OBS Browser Source URL (Room {roomId})
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Add this URL directly as a Browser Source in OBS Studio (1280×720), then click
              Start Virtual Camera in OBS to send your phone video into Zoom or Google Meet.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800">
              {feedUrl}
            </code>
            <button
              type="button"
              onClick={copyFeedUrl}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              {copiedFeed ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedFeed ? 'Copied URL' : 'Copy Feed URL'}
            </button>
            <a
              href={feedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open Clean Feed
            </a>
          </div>
        </div>
      </div>

      {/* Platform Driver Selector */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 p-2 bg-slate-50 rounded-t-xl">
          {(
            [
              { id: 'windows', label: 'Windows (OBS Virtual Camera)' },
              { id: 'macos', label: 'macOS (CoreMediaIO / OBS)' },
              { id: 'linux', label: 'Linux (v4l2loopback)' },
              { id: 'obs-browser', label: 'Zoom & Google Meet Selection' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPlatform(tab.id)}
              className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                platform === tab.id
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {platform === 'windows' && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-slate-900">
                Windows 10 / 11 Virtual Camera Setup
              </h3>
              <ol className="list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-slate-700">
                <li>
                  Install <strong>OBS Studio 30+</strong> (automatically registers the{' '}
                  <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                    OBS Virtual Camera
                  </code>{' '}
                  DirectShow &amp; Media Foundation device).
                </li>
                <li>
                  Either add the Clean Feed URL above as an <strong>OBS Browser Source</strong> and click{' '}
                  <strong>Start Virtual Camera</strong>, or run the My Web Cam Desktop app and click{' '}
                  <strong>Enable Virtual Webcam Output</strong> (uses <code className="font-mono text-xs">pyvirtualcam</code>).
                </li>
                <li>
                  Open Zoom, Google Meet, or Microsoft Teams → Video Settings → select{' '}
                  <strong>OBS Virtual Camera</strong>.
                </li>
              </ol>
            </div>
          )}

          {platform === 'macos' && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-slate-900">
                macOS Sonoma / Sequoia Virtual Camera Setup
              </h3>
              <ol className="list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-slate-700">
                <li>
                  Install <strong>OBS Studio 30+</strong> for macOS (includes the signed Apple CoreMediaIO
                  Camera Extension required by modern Chrome, Meet, and Zoom).
                </li>
                <li>
                  Launch OBS once, click <strong>Start Virtual Camera</strong>, and approve the system extension
                  in <strong>System Settings → General → Login Items &amp; Extensions → Camera Extensions</strong>.
                </li>
                <li>
                  Stream using the Clean Feed Browser Source in OBS or run the My Web Cam Desktop Bridge,
                  then pick <strong>OBS Virtual Camera</strong> in Google Meet (Chrome/Safari) or Zoom.
                </li>
              </ol>
            </div>
          )}

          {platform === 'linux' && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-slate-900">
                Linux Kernel Virtual Webcam Setup (v4l2loopback)
              </h3>
              <p className="text-sm text-slate-600">
                Linux exposes virtual webcams as native V4L2 devices (<code className="font-mono text-xs">/dev/video*</code>)
                using the <code className="font-mono text-xs">v4l2loopback</code> kernel module:
              </p>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
{`# 1. Install v4l2loopback (Debian / Ubuntu)
sudo apt update && sudo apt install -y v4l2loopback-dkms python3-pip

# 2. Load virtual camera device labeled "My Web Cam"
sudo modprobe v4l2loopback devices=1 video_nr=2 card_label="My Web Cam" exclusive_caps=1

# 3. Install bridge dependencies and connect to your Android phone
pip install -r native/desktop/virtual-cam/requirements.txt
python3 my_web_cam_virtual_bridge.py --url ws://<PHONE_WIFI_IP>:8765`}
              </pre>
              <p className="text-sm text-slate-600">
                After running the bridge, <strong>My Web Cam</strong> appears immediately in Chromium/Google Meet,
                Zoom, and OBS Video Capture Device lists.
              </p>
            </div>
          )}

          {platform === 'obs-browser' && (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="mb-2 flex items-center gap-2 text-slate-900 font-semibold text-sm">
                  <Video className="h-4 w-4 text-blue-600" />
                  Zoom &amp; Microsoft Teams
                </div>
                <p className="text-sm leading-relaxed text-slate-600">
                  Open <strong>Settings → Video</strong>, open the <strong>Camera</strong> dropdown, and choose{' '}
                  <strong>OBS Virtual Camera</strong> (Windows/macOS) or <strong>My Web Cam</strong> (Linux).
                  If the video appears mirrored to you locally, toggle <em>Mirror my video</em> inside Zoom
                  without affecting what participants see.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="mb-2 flex items-center gap-2 text-slate-900 font-semibold text-sm">
                  <Monitor className="h-4 w-4 text-blue-600" />
                  Google Meet &amp; Web Browsers
                </div>
                <p className="text-sm leading-relaxed text-slate-600">
                  Click the three-dot menu → <strong>Settings → Video → Camera</strong>, then pick{' '}
                  <strong>OBS Virtual Camera</strong> or <strong>My Web Cam</strong>. On macOS, restart Chrome
                  once after enabling the CoreMediaIO extension if the camera list does not refresh immediately.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
