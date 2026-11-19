import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  Copy,
  Lock,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  SwitchCamera,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { RoomPublicState } from '../../server/sessionStore';
import {
  buildMediaConstraints,
  buildPairingUrl,
  DEFAULT_STREAM_CONFIG,
  FRAME_RATE_OPTIONS,
  mapCameraError,
  RESOLUTION_PRESETS,
  validateRemotePassword,
  type CameraStreamConfig,
  type FrameRateOption,
  type ResolutionId,
  type StreamSourceKind,
} from '../utils/streamConfig';
import { QrCodeView } from './QrCodeView';

interface PhoneStreamerProps {
  roomId: string;
  onChangeRoomId: (roomId: string) => void;
  suggestedBaseUrl: string;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export function PhoneStreamer({ roomId, onChangeRoomId, suggestedBaseUrl }: PhoneStreamerProps) {
  const [config, setConfig] = useState<CameraStreamConfig>(DEFAULT_STREAM_CONFIG);
  const [sourceKind, setSourceKind] = useState<StreamSourceKind>('camera');
  const [streaming, setStreaming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [roomState, setRoomState] = useState<RoomPublicState | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Remote access password controls
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [remotePasswordInput, setRemotePasswordInput] = useState('');
  const [remotePasswordError, setRemotePasswordError] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const testPatternRafRef = useRef<number | null>(null);
  const relayIntervalRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const streamingRef = useRef(false);
  const configRef = useRef(config);
  const sourceKindRef = useRef(sourceKind);

  streamingRef.current = streaming;
  configRef.current = config;
  sourceKindRef.current = sourceKind;

  const pairingUrl = buildPairingUrl(suggestedBaseUrl, roomId, 'phone');

  const sendPhoneState = useCallback(
    (active: boolean, errMsg: string | null = null, kind: StreamSourceKind = sourceKindRef.current) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: 'phone:state',
          streamActive: active,
          connectionState: errMsg ? 'error' : active ? 'live' : 'waiting',
          settings: {
            facing: configRef.current.facing,
            resolution: configRef.current.resolution,
            frameRate: configRef.current.frameRate,
            micEnabled: configRef.current.micEnabled,
            sourceKind: kind,
          },
          lastError: errMsg,
        }),
      );
    },
    [],
  );

  const closeAllPeers = useCallback(() => {
    for (const pc of peerConnectionsRef.current.values()) {
      pc.close();
    }
    peerConnectionsRef.current.clear();
  }, []);

  const createOfferForDesktop = useCallback(async (targetId: string) => {
    const stream = streamRef.current;
    const ws = wsRef.current;
    if (!stream || !ws || ws.readyState !== WebSocket.OPEN) return;

    const existing = peerConnectionsRef.current.get(targetId);
    if (existing) existing.close();

    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnectionsRef.current.set(targetId, pc);

    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'webrtc:ice',
            targetId,
            candidate: ev.candidate,
          }),
        );
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(
        JSON.stringify({
          type: 'webrtc:offer',
          targetId,
          sdp: pc.localDescription,
        }),
      );
    } catch {
      // Frame relay fallback remains active
    }
  }, []);

  // WebSocket signaling connection with automatic Wi-Fi reconnect
  useEffect(() => {
    let disposed = false;

    const connectWs = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?room=${encodeURIComponent(roomId)}&role=phone`;
      setWsStatus((prev) => (prev === 'reconnecting' ? 'reconnecting' : 'connecting'));

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setWsStatus('connected');
        sendPhoneState(streamingRef.current, null);
      };

      ws.onmessage = async (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data) as {
            type: string;
            state?: RoomPublicState;
            senderId?: string;
            targetId?: string;
            sdp?: RTCSessionDescriptionInit;
            candidate?: RTCIceCandidateInit;
          };

          if ((msg.type === 'welcome' || msg.type === 'room:state') && msg.state) {
            setRoomState(msg.state);
            return;
          }

          if (msg.type === 'stream:request-offer' && msg.targetId && streamingRef.current) {
            await createOfferForDesktop(msg.targetId);
            return;
          }

          if (msg.type === 'webrtc:answer' && msg.senderId && msg.sdp) {
            const pc = peerConnectionsRef.current.get(msg.senderId);
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            }
            return;
          }

          if (msg.type === 'webrtc:ice' && msg.senderId && msg.candidate) {
            const pc = peerConnectionsRef.current.get(msg.senderId);
            if (pc) {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            }
          }
        } catch {
          // Ignore malformed signaling messages
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setWsStatus('reconnecting');
        closeAllPeers();
        reconnectTimerRef.current = window.setTimeout(connectWs, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWs();

    const handleOnline = () => {
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        connectWs();
      }
    };
    const handleOffline = () => setWsStatus('reconnecting');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      disposed = true;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      closeAllPeers();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, closeAllPeers, createOfferForDesktop, sendPhoneState]);

  const stopHardwareStream = useCallback(() => {
    if (testPatternRafRef.current) {
      cancelAnimationFrame(testPatternRafRef.current);
      testPatternRafRef.current = null;
    }
    if (relayIntervalRef.current) {
      clearInterval(relayIntervalRef.current);
      relayIntervalRef.current = null;
    }
    closeAllPeers();
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreaming(false);
    sendPhoneState(false, null);
  }, [closeAllPeers, sendPhoneState]);

  useEffect(() => {
    return () => {
      stopHardwareStream();
    };
  }, [stopHardwareStream]);

  const startSyntheticSignalStream = useCallback(
    (nextConfig: CameraStreamConfig): MediaStream => {
      const preset = RESOLUTION_PRESETS[nextConfig.resolution];
      const canvas = document.createElement('canvas');
      canvas.width = preset.width;
      canvas.height = preset.height;
      const ctx = canvas.getContext('2d')!;
      let frame = 0;

      const draw = () => {
        frame += 1;
        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = '#0B0F19';
        ctx.fillRect(0, 0, w, h);

        // Moving calibration grid and sweep bar
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 80) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y < h; y += 80) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        const sweepX = ((frame * 6) % (w + 160)) - 80;
        const grad = ctx.createLinearGradient(sweepX - 60, 0, sweepX + 60, 0);
        grad.addColorStop(0, 'rgba(37, 99, 235, 0)');
        grad.addColorStop(0.5, 'rgba(37, 99, 235, 0.45)');
        grad.addColorStop(1, 'rgba(37, 99, 235, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(sweepX - 60, 0, 120, h);

        // Center lens reticle
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.18, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#F8FAFC';
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('My Web Cam · Live Test Feed', w / 2, h / 2 - 12);

        ctx.fillStyle = '#94A3B8';
        ctx.font = '22px monospace';
        const now = new Date().toLocaleTimeString();
        ctx.fillText(
          `${nextConfig.facing.toUpperCase()} · ${preset.id.toUpperCase()} · ${nextConfig.frameRate} FPS · ${now}`,
          w / 2,
          h / 2 + 28,
        );

        testPatternRafRef.current = requestAnimationFrame(draw);
      };

      draw();
      return canvas.captureStream(nextConfig.frameRate);
    },
    [],
  );

  const startRelayPump = useCallback((fps: number) => {
    if (relayIntervalRef.current) {
      clearInterval(relayIntervalRef.current);
    }
    const relayCanvas = document.createElement('canvas');
    const relayCtx = relayCanvas.getContext('2d');
    const intervalMs = Math.max(50, Math.round(1000 / Math.min(fps, 15)));

    relayIntervalRef.current = window.setInterval(() => {
      const ws = wsRef.current;
      const vid = videoRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !vid || vid.readyState < 2 || !relayCtx) {
        return;
      }
      const targetW = Math.min(vid.videoWidth || 640, 640);
      const targetH = Math.round(((vid.videoHeight || 360) / (vid.videoWidth || 640)) * targetW) || 360;
      relayCanvas.width = targetW;
      relayCanvas.height = targetH;
      relayCtx.drawImage(vid, 0, 0, targetW, targetH);

      relayCanvas.toBlob(
        async (blob) => {
          if (!blob || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          const buf = await blob.arrayBuffer();
          const packet = new Uint8Array(buf.byteLength + 1);
          packet[0] = 0x01;
          packet.set(new Uint8Array(buf), 1);
          wsRef.current.send(packet);
        },
        'image/jpeg',
        0.72,
      );
    }, intervalMs);
  }, []);

  const startStream = useCallback(
    async (nextConfig: CameraStreamConfig, requestedKind: StreamSourceKind = sourceKind) => {
      setStarting(true);
      setCameraError(null);

      // Clean any prior active tracks first
      if (testPatternRafRef.current) {
        cancelAnimationFrame(testPatternRafRef.current);
        testPatternRafRef.current = null;
      }
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop();
        streamRef.current = null;
      }

      try {
        let mediaStream: MediaStream;
        if (requestedKind === 'test-pattern') {
          mediaStream = startSyntheticSignalStream(nextConfig);
        } else {
          if (!navigator.mediaDevices?.getUserMedia) {
            throw Object.assign(new Error('Camera API unavailable'), { name: 'NotFoundError' });
          }
          mediaStream = await navigator.mediaDevices.getUserMedia(
            buildMediaConstraints(nextConfig),
          );
        }

        // Handle camera track unplugged or revoked mid-stream
        for (const track of mediaStream.getVideoTracks()) {
          track.onended = () => {
            setCameraError('Camera track stopped unexpectedly. Tap Start Camera Stream to resume.');
            stopHardwareStream();
          };
        }

        streamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play().catch(() => {});
        }

        setSourceKind(requestedKind);
        setStreaming(true);
        sendPhoneState(true, null, requestedKind);
        startRelayPump(nextConfig.frameRate);

        // Notify connected desktop clients by requesting/sending offers if any are present
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          await createOfferForDesktop('broadcast');
        }
      } catch (err) {
        const friendly = mapCameraError(err);
        setCameraError(friendly);
        setStreaming(false);
        sendPhoneState(false, friendly, requestedKind);
      } finally {
        setStarting(false);
      }
    },
    [
      createOfferForDesktop,
      sendPhoneState,
      sourceKind,
      startRelayPump,
      startSyntheticSignalStream,
      stopHardwareStream,
    ],
  );

  const updateConfigAndRestartIfLive = (patch: Partial<CameraStreamConfig>) => {
    const updated = { ...config, ...patch };
    setConfig(updated);
    configRef.current = updated;
    if (streaming) {
      void startStream(updated, sourceKind);
    } else {
      sendPhoneState(false, null);
    }
  };

  const handleToggleRemoteAccess = async () => {
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
    setRemotePasswordError(null);
    setShowRemoteModal(true);
  };

  const handleConfirmRemotePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateRemotePassword(remotePasswordInput);
    if (!check.valid) {
      setRemotePasswordError(check.reason ?? 'Invalid password.');
      return;
    }
    setRemoteBusy(true);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/remote-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, password: remotePasswordInput }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; state?: RoomPublicState };
      if (!res.ok || !data.ok) {
        setRemotePasswordError(data.error ?? 'Failed to enable remote access.');
        return;
      }
      if (data.state) setRoomState(data.state);
      setRemotePasswordInput('');
      setShowRemoteModal(false);
    } finally {
      setRemoteBusy(false);
    }
  };

  const copyPairingUrl = async () => {
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const preset = RESOLUTION_PRESETS[config.resolution];

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      {/* Status Summary Bar */}
      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {wsStatus === 'connected' ? (
            <Wifi className="h-5 w-5 text-emerald-600 shrink-0" />
          ) : (
            <WifiOff className="h-5 w-5 text-amber-600 shrink-0" />
          )}
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {wsStatus === 'reconnecting'
                ? 'Wi-Fi disconnected · Reconnecting automatically...'
                : streaming
                  ? `Streaming live · ${roomState?.desktopCount ?? 0} desktop receiver connected`
                  : 'Camera standby · Permissions requested only when you start'}
            </p>
            <p className="text-xs text-slate-500 tabular-nums">
              Room {roomId} · {preset.id.toUpperCase()} · {config.frameRate} fps ·{' '}
              {config.micEnabled ? 'Mic on' : 'Video only'} · Not recording
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="phone-room-input" className="text-xs font-medium text-slate-600 whitespace-nowrap">
            Room
          </label>
          <input
            id="phone-room-input"
            type="text"
            value={roomId}
            onChange={(e) => onChangeRoomId(e.target.value.toUpperCase())}
            className="w-28 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs font-medium uppercase text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Main 2-column responsive layout: Camera viewport + Touch controls */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* Left: Live Camera Preview & Start/Stop CTA */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-[#0B0F19] border border-slate-800">
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              data-testid="phone-preview-video"
              className={`h-full w-full object-cover ${streaming ? 'block' : 'hidden'}`}
            />

            {!streaming && (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-300">
                  <Camera className="h-6 w-6" />
                </div>
                <p className="text-sm font-medium text-slate-100">
                  Camera off — ready to stream over Wi-Fi
                </p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-400">
                  Tap Start Camera Stream below to request camera access and broadcast live video
                  to your paired desktop.
                </p>
              </div>
            )}

            {streaming && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-4">
                <div className="flex items-center justify-between text-xs font-medium text-white tabular-nums">
                  <span>
                    {sourceKind === 'test-pattern' ? 'Test Signal' : `${config.facing === 'environment' ? 'Rear' : 'Front'} Camera`} · {preset.width}×{preset.height} · {config.frameRate} fps
                  </span>
                  <span>{config.micEnabled ? 'Audio Active' : 'No Audio'}</span>
                </div>
              </div>
            )}
          </div>

          {cameraError && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <div className="space-y-2">
                  <p className="font-medium">{cameraError}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void startStream(config, 'camera')}
                      className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retry Camera
                    </button>
                    <button
                      type="button"
                      onClick={() => void startStream(config, 'test-pattern')}
                      className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100"
                    >
                      Use Test Camera Signal
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Primary Ergonomic Thumb-Zone Start/Stop Controls */}
          <div className="flex flex-col gap-3 sm:flex-row">
            {!streaming ? (
              <>
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => void startStream(config, 'camera')}
                  className="min-h-[48px] flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                >
                  <Play className="h-4 w-4" />
                  {starting ? 'Starting Camera...' : 'Start Camera Stream'}
                </button>
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => void startStream(config, 'test-pattern')}
                  className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50"
                >
                  Stream Test Signal
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={stopHardwareStream}
                className="min-h-[48px] flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700"
              >
                <Square className="h-4 w-4" />
                Stop Camera Stream
              </button>
            )}
          </div>
        </div>

        {/* Right: Camera Controls, Security & QR Pairing */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
            <h2 className="text-base font-semibold text-slate-900">Camera &amp; Audio Controls</h2>

            {/* Camera Lens */}
            <div>
              <span className="block text-xs font-medium text-slate-600 mb-2">Camera Lens</span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: 'environment', label: 'Rear Camera' },
                    { id: 'user', label: 'Front Camera' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => updateConfigAndRestartIfLive({ facing: item.id })}
                    className={`min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      config.facing === item.id
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <SwitchCamera className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Resolution */}
            <div>
              <span className="block text-xs font-medium text-slate-600 mb-2">Resolution</span>
              <div className="grid grid-cols-3 gap-2">
                {(['480p', '720p', '1080p'] as ResolutionId[]).map((resId) => (
                  <button
                    key={resId}
                    type="button"
                    onClick={() => updateConfigAndRestartIfLive({ resolution: resId })}
                    className={`min-h-[44px] rounded-lg border px-2 py-2 text-xs font-medium tabular-nums transition-colors ${
                      config.resolution === resId
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {resId.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Frame Rate */}
            <div>
              <span className="block text-xs font-medium text-slate-600 mb-2">Target Frame Rate</span>
              <div className="grid grid-cols-4 gap-2">
                {FRAME_RATE_OPTIONS.map((fps: FrameRateOption) => (
                  <button
                    key={fps}
                    type="button"
                    onClick={() => updateConfigAndRestartIfLive({ frameRate: fps })}
                    className={`min-h-[44px] rounded-lg border px-2 py-2 text-xs font-medium tabular-nums transition-colors ${
                      config.frameRate === fps
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {fps} fps
                  </button>
                ))}
              </div>
            </div>

            {/* Microphone Toggle */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <div className="flex items-center gap-2.5">
                {config.micEnabled ? (
                  <Mic className="h-4 w-4 text-blue-600" />
                ) : (
                  <MicOff className="h-4 w-4 text-slate-400" />
                )}
                <div>
                  <p className="text-sm font-medium text-slate-900">Microphone Audio Stream</p>
                  <p className="text-xs text-slate-500">
                    {config.micEnabled
                      ? 'Audio included with camera feed'
                      : 'Disabled (mic permission not requested)'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.micEnabled}
                aria-label="Toggle microphone audio stream"
                onClick={() => updateConfigAndRestartIfLive({ micEnabled: !config.micEnabled })}
                className={`min-h-[44px] min-w-[72px] rounded-lg px-3 text-xs font-semibold transition-colors ${
                  config.micEnabled
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {config.micEnabled ? 'On' : 'Off'}
              </button>
            </div>

            {/* Network Security */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <div className="flex items-center gap-2.5">
                {roomState?.networkMode === 'remote-enabled' ? (
                  <ShieldCheck className="h-4 w-4 text-amber-600" />
                ) : (
                  <Lock className="h-4 w-4 text-emerald-600" />
                )}
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {roomState?.networkMode === 'remote-enabled'
                      ? 'Remote Access Enabled'
                      : 'Local Wi-Fi Only'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {roomState?.networkMode === 'remote-enabled'
                      ? 'Password required for external networks'
                      : 'External connections blocked by default'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={remoteBusy}
                onClick={handleToggleRemoteAccess}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50"
              >
                {roomState?.networkMode === 'remote-enabled' ? 'Lock to LAN' : 'Remote Access'}
              </button>
            </div>
          </div>

          {/* Pairing QR Code & Instructions */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">Pairing URL &amp; QR Code</h2>
            <p className="mt-1 text-xs text-slate-600">
              Keep both your phone and computer on the same Wi-Fi network, then open this link on
              your desktop or scan the QR code.
            </p>
            <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <QrCodeView value={pairingUrl} size={132} label="Phone pairing QR code" />
              <div className="flex-1 min-w-0 space-y-2.5">
                <code className="block break-all rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs text-slate-800">
                  {pairingUrl}
                </code>
                <button
                  type="button"
                  onClick={copyPairingUrl}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedUrl ? 'Copied Pairing URL' : 'Copy URL'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Password Modal for Remote Access */}
      {showRemoteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="phone-remote-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <form
            onSubmit={handleConfirmRemotePassword}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 space-y-4 shadow-lg"
          >
            <h3 id="phone-remote-modal-title" className="text-lg font-semibold text-slate-900">
              Set Remote Access Password
            </h3>
            <p className="text-sm text-slate-600">
              Streaming stays restricted to your local Wi-Fi network unless you set a password
              (minimum 6 characters).
            </p>
            <div>
              <label htmlFor="phone-remote-pw" className="block text-xs font-medium text-slate-700 mb-1.5">
                Remote Access Password
              </label>
              <input
                id="phone-remote-pw"
                type="password"
                value={remotePasswordInput}
                onChange={(e) => setRemotePasswordInput(e.target.value)}
                placeholder="Enter at least 6 characters"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                autoFocus
              />
              {remotePasswordError && (
                <p className="mt-1.5 text-xs font-medium text-red-600">{remotePasswordError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRemoteModal(false)}
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={remoteBusy}
                className="min-h-[40px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
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
