import { useState } from 'react';
import { AlertCircle, Download, FileCode2, Laptop, Smartphone, Terminal } from 'lucide-react';

async function downloadVerifiedFile(
  url: string,
  filename: string,
  expectZip: boolean,
): Promise<void> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (expectZip) {
    const isZipHeader =
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04;
    if (!isZipHeader) {
      throw new Error(
        'Received a non-ZIP response from the preview proxy. Open the app in a direct browser tab and retry.',
      );
    }
  }

  const blob = new Blob([buffer], {
    type: expectZip ? 'application/zip' : 'text/x-python',
  });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

export function NativeDownloads() {
  const [busyKey, setBusyKey] = useState<'android' | 'desktop' | 'bridge' | 'full' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownload = async (
    key: 'android' | 'desktop' | 'bridge' | 'full',
    url: string,
    filename: string,
    expectZip: boolean,
  ) => {
    setBusyKey(key);
    setDownloadError(null);
    try {
      await downloadVerifiedFile(url, filename, expectZip);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Unable to download archive.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 text-balance">
            Native Android &amp; Desktop Source Projects
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-600">
            Download the complete source projects for the native Android app (Kotlin, Jetpack Compose,
            CameraX) and the cross-platform Desktop receiver (Electron + Python virtual webcam bridge),
            along with one-command scripts to compile the installable APK and desktop installers.
          </p>
        </div>
        <button
          type="button"
          disabled={busyKey !== null}
          onClick={() =>
            void handleDownload(
              'full',
              '/api/download/full-project.zip',
              'my-web-cam-github-project.zip',
              true,
            )
          }
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" />
          {busyKey === 'full' ? 'Preparing Repo ZIP...' : 'Download Full GitHub Repo (.zip)'}
        </button>
      </div>

      {downloadError && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <span>{downloadError}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Android Project Card */}
        <article className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6">
          <div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-800">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    My Web Cam — Android App
                  </h2>
                  <p className="text-xs text-slate-500">
                    Kotlin · Jetpack Compose · CameraX 1.4 · ZXing QR
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              Captures rear or front camera video on Android 8.0+ (API 26–35) with selectable
              480p / 720p / 1080p resolution, 15–60 fps target frame rate, optional microphone PCM
              audio, on-demand permission prompts, and local Wi-Fi socket streaming with password-gated
              remote access.
            </p>

            <div className="mt-4 rounded-lg bg-slate-900 p-3.5 font-mono text-xs text-slate-100">
              <div className="text-slate-400 mb-1">Build installable APK (requires Android SDK 35 + JDK 17):</div>
              <div>cd native/android &amp;&amp; ./build-apk.sh</div>
              <div className="mt-1 text-slate-400">Output: app/build/outputs/apk/debug/app-debug.apk</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() =>
                void handleDownload(
                  'android',
                  '/api/download/android-source.zip',
                  'my-web-cam-android-source.zip',
                  true,
                )
              }
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4" />
              {busyKey === 'android' ? 'Preparing ZIP...' : 'Download Android Source (.zip)'}
            </button>
            <span className="text-xs text-slate-500">
              Includes Gradle build files &amp; GitHub Actions APK workflow
            </span>
          </div>
        </article>

        {/* Desktop Project Card */}
        <article className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6">
          <div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-800">
                  <Laptop className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    My Web Cam — Desktop Receiver
                  </h2>
                  <p className="text-xs text-slate-500">
                    Electron · TypeScript · pyvirtualcam · Windows / macOS / Linux
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              Displays the live Wi-Fi camera stream from your Android phone and drives the system
              virtual webcam bridge (<code className="font-mono text-xs">bridge.py</code>) so Zoom,
              Google Meet, and OBS can select your phone as a camera source.
            </p>

            <div className="mt-4 rounded-lg bg-slate-900 p-3.5 font-mono text-xs text-slate-100">
              <div className="text-slate-400 mb-1">Build desktop installers (.exe / .dmg / .AppImage):</div>
              <div>cd native/desktop &amp;&amp; npm install &amp;&amp; ./build-desktop.sh</div>
              <div className="mt-1 text-slate-400">Output: native/desktop/release/</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() =>
                void handleDownload(
                  'desktop',
                  '/api/download/desktop-source.zip',
                  'my-web-cam-desktop-source.zip',
                  true,
                )
              }
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4" />
              {busyKey === 'desktop' ? 'Preparing ZIP...' : 'Download Desktop Source (.zip)'}
            </button>
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() =>
                void handleDownload(
                  'bridge',
                  '/api/download/virtual-cam-bridge.py',
                  'my_web_cam_virtual_bridge.py',
                  false,
                )
              }
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <FileCode2 className="h-4 w-4" />
              {busyKey === 'bridge' ? 'Downloading...' : 'Bridge Script (.py)'}
            </button>
          </div>
        </article>
      </div>

      {/* Honest Packaging & Web App Usage Note */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-3">
          <Terminal className="mt-0.5 h-5 w-5 text-slate-700 shrink-0" />
          <div className="space-y-2 text-sm text-slate-600">
            <h3 className="font-semibold text-slate-900">
              Instant Browser Mode vs. Compiled Native Packages
            </h3>
            <p className="leading-relaxed">
              You can use <strong>My Web Cam</strong> immediately without compiling anything: open{' '}
              <strong>Desktop Receiver</strong> on your computer, scan the pairing QR code with Chrome
              on your Android phone to open <strong>Phone Camera</strong> mode, and stream live video
              over Wi-Fi right away.
            </p>
            <p className="leading-relaxed">
              Because this cloud sandbox does not include the Android SDK or Electron native desktop
              packaging toolchains, pre-compiled binary <code className="font-mono text-xs">.apk</code>,{' '}
              <code className="font-mono text-xs">.exe</code>, and <code className="font-mono text-xs">.dmg</code>{' '}
              installers are generated from the included source projects using{' '}
              <code className="font-mono text-xs">./build-apk.sh</code>,{' '}
              <code className="font-mono text-xs">./build-desktop.sh</code>, or the bundled{' '}
              <code className="font-mono text-xs">.github/workflows/build-releases.yml</code> GitHub Actions workflow.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
