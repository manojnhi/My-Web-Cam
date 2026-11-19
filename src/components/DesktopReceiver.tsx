import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Lock,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Video,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { RoomPublicState } from '../../server/sessionStore';
import {
  buildPairingUrl,
  formatDuration,
  RESOLUTION_PRESETS,
  validateRemotePassword,
} from '../utils/streamConfig';
import { QrCodeView } from './QrCodeView';

interface DesktopReceiverProps {
  roomId: string;
  onChangeRoomId: (roomId: string) => void;
  onNewRoom: () => void;
  suggestedBaseUrl: string;
  feedOnly?: boolean;
  onOpenVirtualCamGuide?: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export function DesktopReceiver({
  roomId,
  onChangeRoomId,
  onNewRoom,
  suggestedBaseUrl,
  feedOnly = false,
  onOpenVirtualCamGuide,
}: DesktopReceiverProps) {
  const [roomState, setRoomState] = useState<RoomPublicState | null>(null);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'blocked'>(
    'connecting',
  );
  const [authError, setAuthError] = useState<{ message: string; requiresPassword: boolean } | null>(
    null,
  );
  const [suppliedPassword, setSuppliedPassword] = useState('');
  const [activeRemotePassword, setActiveRemotePassword] = useState('');
  const [simulateRemote, setSimulateRemote] = useState(false);

  // Remote access configuration modal
  const [showHostPasswordModal, setShowHostPasswordModal] = useState(false);
  const [hostPasswordInput, setHostPasswordInput] = useState('');
  const [hostPasswordError, setHostPasswordError] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);

  // Media rendering state
  const [hasWebRtcVideo, setHasWebRtcVideo] = useState(false);
  const [hasRelayFrames, setHasRelayFrames] = useState(false);
  const [measuredFps, setMeasuredFps] = useState(0);
  const [audioMuted, setAudioMuted] = useState(true);
  const [copiedPhoneUrl, setCopiedPhoneUrl] = useState(false);
  const [copiedObsUrl, setCopiedObsUrl] = useState(false);

  // Explicit user-initiated local clip recording (off by default)
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const frameCounterRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);

  const phonePairingUrl = buildPairingUrl(suggestedBaseUrl, roomId, 'phone');
  const obsFeedUrl = buildPairingUrl(
    typeof window !== 'undefined' ? window.location.origin : suggestedBaseUrl,
    roomId,
    'feed',
  );

  const isStreamReceiving = Boolean(roomState?.streamActive && (hasWebRtcVideo || hasRelayFrames));

  const cleanupPeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setHasWebRtcVideo(false);
  }, []);

  // Measure real incoming frame rate once per second
  useEffect(() => {
    const timer = window.setInterval(() => {
      setMeasuredFps(frameCounterRef.current);
      frameCounterRef.current = 0;
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Recording timer
  useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0);
      return;
    }
    const timer = window.setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  // Connect WebSocket signaling & binary frame fallback
  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({
        room: roomId,
        role: 'desktop',
      });
      if (activeRemotePassword) {
        params.set('password', activeRemotePassword);
      }
      if (simulateRemote) {
        params.set('simulateRemote', '1');
      }

      const wsUrl = `${protocol}//${window.location.host}/ws?${params.toString()}`;
      setWsStatus((prev) => (prev === 'reconnecting' ? 'reconnecting' : 'connecting'));

      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setAuthError(null);
        setWsStatus('connected');
      };

      ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          if (bytes.length < 2 || bytes[0] !== 0x01) return;
          const blob = new Blob([bytes.subarray(1)], { type: 'image/jpeg' });
          try {
            const bitmap = await createImageBitmap(blob);
            const canvas = canvasRef.current;
            if (canvas) {
              if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
              }
              const ctx = canvas.getContext('2d');
              ctx?.drawImage(bitmap, 0, 0);
              frameCounterRef.current += 1;
              setHasRelayFrames(true);
            }
            bitmap.close();
          } catch {
            // Skip corrupt frame
          }
          return;
        }

        if (typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data) as {
            type: string;
            error?: string;
            requiresPassword?: boolean;
            state?: RoomPublicState;
            senderId?: string;
            sdp?: RTCSessionDescriptionInit;
            candidate?: RTCIceCandidateInit;
          };

          if (msg.type === 'auth:error') {
            setAuthError({
              message: msg.error ?? 'Access denied.',
              requiresPassword: Boolean(msg.requiresPassword),
            });
            setWsStatus('blocked');
            return;
          }

          if ((msg.type === 'welcome' || msg.type === 'room:state') && msg.state) {
            setRoomState(msg.state);
            if (!msg.state.streamActive) {
              setHasRelayFrames(false);
              cleanupPeerConnection();
            }
            return;
          }

          if (msg.type === 'webrtc:offer' && msg.sdp && msg.senderId) {
            cleanupPeerConnection();
            const pc = new RTCPeerConnection(RTC_CONFIG);
            pcRef.current = pc;

            pc.ontrack = (ev) => {
              const stream = ev.streams[0];
              if (stream && videoRef.current) {
                const videoEl = videoRef.current;
                videoEl.srcObject = stream;
                const markReadyIfDecoded = () => {
                  if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
                    setHasWebRtcVideo(true);
                  }
                };
                videoEl.onloadeddata = markReadyIfDecoded;
                videoEl.onresize = markReadyIfDecoded;
                void videoEl.play().catch(() => {});
              }
            };

            pc.onicecandidate = (ev) => {
              if (ev.candidate && ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'webrtc:ice',
                    targetId: msg.senderId,
                    candidate: ev.candidate,
                  }),
                );
              }
            };

            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(
              JSON.stringify({
                type: 'webrtc:answer',
                targetId: msg.senderId,
                sdp: pc.localDescription,
              }),
            );
            return;
          }

          if (msg.type === 'webrtc:ice' && msg.candidate && pcRef.current) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
          }
        } catch {
          // Ignore malformed packet
        }
      };

      ws.onclose = (ev) => {
        if (disposed) return;
        cleanupPeerConnection();
        if (ev.code === 4001) {
          setWsStatus('blocked');
          return;
        }
        setWsStatus('reconnecting');
        reconnectTimerRef.current = window.setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      cleanupPeerConnection();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, activeRemotePassword, simulateRemote, cleanupPeerConnection]);

  const handleToggleHostRemoteAccess = async () => {
    if (roomState?.networkMode === 'remote-enabled') {
      setRemoteBusy(true);
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/remote-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        });
        const data = (await res.json()) as { ok: boolean; state?: RoomPublicState };
        if (data.state) setRoomState(data.state);
      } finally {
        setRemoteBusy(false);
      }
      return;
    }
    setHostPasswordError(null);
    setShowHostPasswordModal(true);
  };

  const handleConfirmHostPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateRemotePassword(hostPasswordInput);
    if (!check.valid) {
      setHostPasswordError(check.reason ?? 'Invalid password.');
      return;
    }
    setRemoteBusy(true);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/remote-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, password: hostPasswordInput }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; state?: RoomPublicState };
      if (!res.ok || !data.ok) {
        setHostPasswordError(data.error ?? 'Could not enable remote access.');
        return;
      }
      if (data.state) setRoomState(data.state);
      setActiveRemotePassword(hostPasswordInput);
      setHostPasswordInput('');
      setShowHostPasswordModal(false);
    } finally {
      setRemoteBusy(false);
    }
  };

  const handleUnlockRemoteClient = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveRemotePassword(suppliedPassword);
  };

  const toggleRecording = () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }

    let sourceStream: MediaStream | null = null;
    if (hasWebRtcVideo && videoRef.current?.srcObject instanceof MediaStream) {
      sourceStream = videoRef.current.srcObject;
    } else if (hasRelayFrames && canvasRef.current) {
      sourceStream = canvasRef.current.captureStream(30);
    }

    if (!sourceStream) return;

    recordedChunksRef.current = [];
    const recorder = new MediaRecorder(sourceStream, {
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm',
    });

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-web-cam-${roomId.toLowerCase()}-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };

    mediaRecorderRef.current = recorder;
    recorder.start(500);
    setRecording(true);
  };

  const copyText = async (value: string, setter: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(value);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  // Clean borderless OBS Browser Source mode
  if (feedOnly) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black overflow-hidden">
        <video
          ref={videoRef}
          muted={audioMuted}
          playsInline
          autoPlay
          className={`h-full w-full object-contain ${hasWebRtcVideo ? 'block' : 'hidden'}`}
        />
        <canvas
          ref={canvasRef}
          className={`h-full w-full object-contain ${!hasWebRtcVideo && hasRelayFrames ? 'block' : 'hidden'}`}
        />
        {!isStreamReceiving && (
          <div className="text-center text-slate-300 font-sans">
            <p className="text-base font-semibold">My Web Cam · Room {roomId}</p>
            <p className="mt-1 text-xs text-slate-400">
              Waiting for phone camera stream over Wi-Fi...
            </p>
          </div>
        )}
      </div>
    );
  }

  const activeSettings = roomState?.settings;
  const activeRes = activeSettings ? RESOLUTION_PRESETS[activeSettings.resolution] : null;

  return (
    <section className="mx-auto max-w-7xl px-6 py-8">
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* Left Dominant Focal Anchor: Live Video Monitor */}
        <div className="lg:col-span-8 space-y-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-[#0B0F19] border border-slate-800">
            <video
              ref={videoRef}
              muted={audioMuted}
              playsInline
              autoPlay
              data-testid="desktop-live-video"
              className={`h-full w-full object-contain ${
                roomState?.streamActive && hasWebRtcVideo ? 'block' : 'hidden'
              }`}
            />
            <canvas
              ref={canvasRef}
              data-testid="desktop-relay-canvas"
              className={`h-full w-full object-contain ${
                roomState?.streamActive && !hasWebRtcVideo && hasRelayFrames ? 'block' : 'hidden'
              }`}
            />

            {/* Blocked / Remote Password Gate */}
            {wsStatus === 'blocked' && authError && (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <Lock className="mb-3 h-10 w-10 text-amber-400" />
                <h2 className="text-lg font-semibold text-white">Remote Access Restricted</h2>
                <p className="mt-1.5 max-w-md text-sm text-slate-300">{authError.message}</p>
                {authError.requiresPassword && (
                  <form
                    onSubmit={handleUnlockRemoteClient}
                    className="mt-4 flex w-full max-w-sm items-center gap-2"
                  >
                    <input
                      type="password"
                      value={suppliedPassword}
                      onChange={(e) => setSuppliedPassword(e.target.value)}
                      placeholder="Enter room password"
                      aria-label="Remote room password"
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Unlock
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Waiting / Reconnecting / Error Empty States */}
            {wsStatus !== 'blocked' && !isStreamReceiving && (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                {roomState?.lastError ? (
                  <>
                    <AlertCircle className="mb-3 h-10 w-10 text-red-400" />
                    <h2 className="text-base font-semibold text-white">Camera Error on Phone</h2>
                    <p className="mt-1.5 max-w-md text-sm text-slate-300">{roomState.lastError}</p>
                  </>
                ) : wsStatus === 'reconnecting' || roomState?.connectionState === 'reconnecting' ? (
                  <>
                    <WifiOff className="mb-3 h-10 w-10 text-amber-400" />
                    <h2 className="text-base font-semibold text-white">
                      Wi-Fi Interrupted — Reconnecting
                    </h2>
                    <p className="mt-1.5 max-w-md text-sm text-slate-300">
                      Waiting for your Android phone to rejoin the local Wi-Fi network and resume
                      Room {roomId}.
                    </p>
                  </>
                ) : (
                  <>
                    <Smartphone className="mb-3 h-10 w-10 text-slate-400" />
                    <h2 className="text-base font-semibold text-white">
                      {roomState?.phoneConnected
                        ? 'Phone paired — tap Start Camera Stream on phone'
                        : 'Waiting for Android phone stream'}
                    </h2>
                    <p className="mt-1.5 max-w-md text-sm text-slate-400">
                      Scan the QR code or open the pairing URL on your Android phone connected to
                      the same Wi-Fi network.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Scrim overlay strictly when live */}
            {isStreamReceiving && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white tabular-nums">
                  <div className="flex items-center gap-2 font-medium">
                    <Radio className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Live Feed · Room {roomId}</span>
                    {recording && (
                      <span className="ml-2 font-semibold text-red-400">
                        REC {formatDuration(recordingSeconds)}
                      </span>
                    )}
                  </div>
                  <div className="text-slate-200">
                    {activeRes ? `${activeRes.width}×${activeRes.height}` : '720p'} ·{' '}
                    {measuredFps > 0 ? `${measuredFps} fps` : `${activeSettings?.frameRate ?? 30} fps target`}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Monitor Controls & Live Telemetry Row */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 tabular-nums">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-900 whitespace-nowrap">
                {wsStatus === 'connected' ? (
                  <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-amber-600" />
                )}
                {isStreamReceiving
                  ? 'Live Stream Active'
                  : roomState?.phoneConnected
                    ? 'Phone Paired · Standby'
                    : 'Waiting for Phone'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">
                {activeSettings
                  ? activeSettings.facing === 'environment'
                    ? 'Rear'
                    : 'Front'
                  : 'Rear'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">
                {activeSettings ? activeSettings.resolution.toUpperCase() : '720P'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">
                {activeSettings?.micEnabled ? 'Mic On' : 'Audio Off'}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setAudioMuted((m) => !m)}
                disabled={!isStreamReceiving || !activeSettings?.micEnabled}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap shrink-0"
              >
                {audioMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                {audioMuted ? 'Unmute Monitor' : 'Mute Monitor'}
              </button>

              <button
                type="button"
                onClick={toggleRecording}
                disabled={!isStreamReceiving}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors disabled:opacity-45 whitespace-nowrap shrink-0 ${
                  recording
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                <Video className="h-3.5 w-3.5" />
                {recording ? `Stop & Save (${formatDuration(recordingSeconds)})` : 'Record Clip'}
              </button>
            </div>
          </div>

          {/* Setup Instructions & Privacy Assurance */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              Desktop Setup &amp; Privacy Guarantee
            </h2>
            <div className="mt-3 grid gap-4 md:grid-cols-3 text-xs leading-relaxed text-slate-600">
              <div>
                <p className="font-semibold text-slate-800">1. Pair over Wi-Fi</p>
                <p className="mt-1">
                  Connect your Android phone and computer to the same Wi-Fi router, then scan the QR
                  code or open the Phone Camera tab on your phone.
                </p>
              </div>
              <div>
                <p className="font-semibold text-slate-800">2. Select Virtual Webcam</p>
                <p className="mt-1">
                  Add the Clean OBS Feed URL to OBS Studio (or run the Desktop Bridge) to use your
                  phone as a selectable camera in Zoom and Google Meet.
                </p>
              </div>
              <div>
                <p className="font-semibold text-slate-800">3. Zero Automatic Recording</p>
                <p className="mt-1">
                  Video frames stream directly in memory and are never saved to disk unless you
                  explicitly click <strong>Record Clip</strong>.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Pairing QR, Room Code, Remote Access Security, Virtual Cam */}
        <aside className="lg:col-span-4 space-y-5">
          {/* Pairing Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">Pair Android Phone</h2>
              <button
                type="button"
                onClick={onNewRoom}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <RefreshCw className="h-3 w-3" />
                New Room
              </button>
            </div>

            <div>
              <label htmlFor="desktop-room-code" className="block text-xs font-medium text-slate-600 mb-1">
                Session Room Code
              </label>
              <input
                id="desktop-room-code"
                type="text"
                value={roomId}
                onChange={(e) => onChangeRoomId(e.target.value.toUpperCase())}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm font-semibold uppercase text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="flex justify-center pt-1">
              <QrCodeView value={phonePairingUrl} size={168} label="Desktop pairing QR code" />
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-medium text-slate-600">Phone Connection URL</span>
              <code className="block break-all rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs text-slate-800">
                {phonePairingUrl}
              </code>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void copyText(phonePairingUrl, setCopiedPhoneUrl)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {copiedPhoneUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedPhoneUrl ? 'Copied' : 'Copy Phone URL'}
                </button>
                <a
                  href={phonePairingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
              </div>
            </div>
          </div>

          {/* Local-Network-Only & Password-Gated Remote Access */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                {roomState?.networkMode === 'remote-enabled' ? (
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-amber-600 shrink-0" />
                ) : (
                  <Lock className="mt-0.5 h-4 w-4 text-emerald-600 shrink-0" />
                )}
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {roomState?.networkMode === 'remote-enabled'
                      ? 'Remote Access Unlocked'
                      : 'Local Wi-Fi Only'}
                  </h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                    {roomState?.networkMode === 'remote-enabled'
                      ? 'Password protection active for connections outside your LAN.'
                      : 'Streaming is restricted to your local Wi-Fi network by default.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={remoteBusy}
                onClick={handleToggleHostRemoteAccess}
                className={`flex-1 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
                  roomState?.networkMode === 'remote-enabled'
                    ? 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {roomState?.networkMode === 'remote-enabled'
                  ? 'Restrict to Local Wi-Fi'
                  : 'Enable Remote Access'}
              </button>
              <button
                type="button"
                onClick={() => setSimulateRemote((v) => !v)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {simulateRemote ? 'Exit External Test' : 'Test External IP'}
              </button>
            </div>
          </div>

          {/* Virtual Webcam Integration Quick Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Zoom, Google Meet &amp; OBS Output
            </h3>
            <p className="text-xs leading-relaxed text-slate-600">
              Use the Clean Feed URL as an OBS Browser Source or run the Virtual Camera Bridge so
              conferencing apps see your phone as a camera.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void copyText(obsFeedUrl, setCopiedObsUrl)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {copiedObsUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedObsUrl ? 'Copied OBS URL' : 'Copy OBS Feed URL'}
              </button>
              {onOpenVirtualCamGuide && (
                <button
                  type="button"
                  onClick={onOpenVirtualCamGuide}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Setup Guide
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Password Modal before enabling remote access */}
      {showHostPasswordModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="host-remote-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <form
            onSubmit={handleConfirmHostPassword}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 space-y-4 shadow-lg"
          >
            <h3 id="host-remote-modal-title" className="text-lg font-semibold text-slate-900">
              Require Password for Remote Access
            </h3>
            <p className="text-sm text-slate-600">
              By default, My Web Cam accepts connections only on your local Wi-Fi. Set a password
              (minimum 6 characters) before allowing remote access.
            </p>
            <div>
              <label htmlFor="host-remote-pw" className="block text-xs font-medium text-slate-700 mb-1.5">
                Room Access Password
              </label>
              <input
                id="host-remote-pw"
                type="password"
                value={hostPasswordInput}
                onChange={(e) => setHostPasswordInput(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                autoFocus
              />
              {hostPasswordError && (
                <p className="mt-1.5 text-xs font-medium text-red-600">{hostPasswordError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowHostPasswordModal(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={remoteBusy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Enable Remote Access
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
