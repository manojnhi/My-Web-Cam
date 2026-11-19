export type CameraFacing = 'environment' | 'user';
export type ResolutionId = '480p' | '720p' | '1080p';
export type FrameRateOption = 15 | 24 | 30 | 60;
export type NetworkMode = 'local-only' | 'remote-enabled';
export type StreamSourceKind = 'camera' | 'test-pattern';

export interface StreamPreset {
  id: ResolutionId;
  label: string;
  width: number;
  height: number;
}

export const RESOLUTION_PRESETS: Record<ResolutionId, StreamPreset> = {
  '480p': { id: '480p', label: '480p SD (854×480)', width: 854, height: 480 },
  '720p': { id: '720p', label: '720p HD (1280×720)', width: 1280, height: 720 },
  '1080p': { id: '1080p', label: '1080p Full HD (1920×1080)', width: 1920, height: 1080 },
};

export const FRAME_RATE_OPTIONS: FrameRateOption[] = [15, 24, 30, 60];

export interface CameraStreamConfig {
  facing: CameraFacing;
  resolution: ResolutionId;
  frameRate: FrameRateOption;
  micEnabled: boolean;
}

export const DEFAULT_STREAM_CONFIG: CameraStreamConfig = {
  facing: 'environment',
  resolution: '720p',
  frameRate: 30,
  micEnabled: false,
};

export function buildMediaConstraints(config: CameraStreamConfig): MediaStreamConstraints {
  const preset = RESOLUTION_PRESETS[config.resolution] ?? RESOLUTION_PRESETS['720p'];
  return {
    video: {
      facingMode: { ideal: config.facing },
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: config.frameRate, max: config.frameRate },
    },
    audio: config.micEnabled
      ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      : false,
  };
}

export function buildPairingUrl(
  baseOrigin: string,
  roomId: string,
  mode: 'phone' | 'feed' = 'phone',
): string {
  const normalizedBase = baseOrigin.replace(/\/+$/, '');
  const cleanRoom = encodeURIComponent(roomId.trim());
  if (mode === 'feed') {
    return `${normalizedBase}/?mode=feed&room=${cleanRoom}`;
  }
  return `${normalizedBase}/?mode=phone&room=${cleanRoom}`;
}

export function isLocalNetworkHost(hostOrIp: string): boolean {
  const raw = hostOrIp.trim().toLowerCase().replace(/^::ffff:/, '');
  if (!raw) return false;
  const host = raw.startsWith('[')
    ? raw.slice(1, raw.indexOf(']'))
    : raw.includes(':') && !raw.includes('::') && raw.split(':').length === 2
      ? raw.split(':')[0]
      : raw;

  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local')
  ) {
    return true;
  }

  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4Match) return false;

  const octets = ipv4Match.slice(1).map((part) => Number(part));
  if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }

  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export interface PasswordValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateRemotePassword(password: string): PasswordValidationResult {
  const trimmed = password.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Enter a password before enabling remote access.' };
  }
  if (trimmed.length < 6) {
    return {
      valid: false,
      reason: 'Password must be at least 6 characters to protect remote access.',
    };
  }
  if (password !== trimmed) {
    return {
      valid: false,
      reason: 'Password cannot start or end with spaces.',
    };
  }
  return { valid: true };
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function mapCameraError(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return 'Unable to access camera hardware. Check device availability and try again.';
  }
  const name = 'name' in err ? String((err as { name?: string }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera or microphone permission was denied. Allow access in browser or system settings, then tap Start Camera Stream.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No physical camera was found on this device. Connect a camera or use the Test Signal source to verify pairing.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is currently in use by another application. Close the other camera app and retry.';
    case 'OverconstrainedError':
      return 'This device does not support the selected resolution or frame rate. Try 720p at 30 fps.';
    default:
      return 'Camera interrupted unexpectedly. Re-open camera permissions or switch to another lens.';
  }
}

export function truncateWsCloseReason(reason: string, maxBytes = 123): string {
  const encoder = new TextEncoder();
  if (encoder.encode(reason).length <= maxBytes) {
    return reason;
  }
  let out = '';
  for (const ch of reason) {
    const candidate = out + ch;
    if (encoder.encode(candidate).length > maxBytes) {
      break;
    }
    out = candidate;
  }
  return out;
}
