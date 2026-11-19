import crypto from 'node:crypto';
import type {
  CameraFacing,
  FrameRateOption,
  NetworkMode,
  ResolutionId,
  StreamSourceKind,
} from '../src/utils/streamConfig.ts';
import { isLocalNetworkHost, validateRemotePassword } from '../src/utils/streamConfig.ts';

export type StreamConnectionState = 'waiting' | 'connecting' | 'live' | 'reconnecting' | 'error';

export interface RoomStreamSettings {
  facing: CameraFacing;
  resolution: ResolutionId;
  frameRate: FrameRateOption;
  micEnabled: boolean;
  sourceKind: StreamSourceKind;
}

export interface RoomPublicState {
  roomId: string;
  networkMode: NetworkMode;
  remotePasswordConfigured: boolean;
  phoneConnected: boolean;
  desktopCount: number;
  streamActive: boolean;
  connectionState: StreamConnectionState;
  settings: RoomStreamSettings;
  lastError: string | null;
  updatedAt: number;
}

interface InternalRoom {
  roomId: string;
  networkMode: NetworkMode;
  passwordSalt: string | null;
  passwordHash: string | null;
  phoneConnected: boolean;
  desktopCount: number;
  streamActive: boolean;
  connectionState: StreamConnectionState;
  settings: RoomStreamSettings;
  lastError: string | null;
  updatedAt: number;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

export class SessionStore {
  private rooms = new Map<string, InternalRoom>();

  getOrCreateRoom(rawRoomId: string): RoomPublicState {
    const roomId = this.normalizeRoomId(rawRoomId);
    const existing = this.rooms.get(roomId);
    if (existing) {
      return this.toPublic(existing);
    }
    const created: InternalRoom = {
      roomId,
      networkMode: 'local-only',
      passwordSalt: null,
      passwordHash: null,
      phoneConnected: false,
      desktopCount: 0,
      streamActive: false,
      connectionState: 'waiting',
      settings: {
        facing: 'environment',
        resolution: '720p',
        frameRate: 30,
        micEnabled: false,
        sourceKind: 'camera',
      },
      lastError: null,
      updatedAt: Date.now(),
    };
    this.rooms.set(roomId, created);
    return this.toPublic(created);
  }

  getRoom(rawRoomId: string): RoomPublicState | null {
    const room = this.rooms.get(this.normalizeRoomId(rawRoomId));
    return room ? this.toPublic(room) : null;
  }

  enableRemoteAccess(
    rawRoomId: string,
    password: string,
  ): { ok: true; state: RoomPublicState } | { ok: false; error: string } {
    const validation = validateRemotePassword(password);
    if (!validation.valid) {
      return { ok: false, error: validation.reason ?? 'Invalid password.' };
    }
    const room = this.ensureInternal(rawRoomId);
    const salt = crypto.randomBytes(16).toString('hex');
    room.passwordSalt = salt;
    room.passwordHash = hashPassword(password, salt);
    room.networkMode = 'remote-enabled';
    room.updatedAt = Date.now();
    return { ok: true, state: this.toPublic(room) };
  }

  disableRemoteAccess(rawRoomId: string): RoomPublicState {
    const room = this.ensureInternal(rawRoomId);
    room.networkMode = 'local-only';
    room.passwordSalt = null;
    room.passwordHash = null;
    room.updatedAt = Date.now();
    return this.toPublic(room);
  }

  canJoinPeer(
    rawRoomId: string,
    clientAddress: string,
    suppliedPassword?: string,
    bypassLocalCheck = false,
  ): { allowed: true } | { allowed: false; reason: string; requiresPassword: boolean } {
    const room = this.ensureInternal(rawRoomId);
    const isLocal = bypassLocalCheck || isLocalNetworkHost(clientAddress);

    if (room.networkMode === 'local-only') {
      if (!isLocal) {
        return {
          allowed: false,
          requiresPassword: false,
          reason:
            'This room is locked to Local Wi-Fi Only. Enable Remote Access with a password on the host to connect from outside the local network.',
        };
      }
      return { allowed: true };
    }

    // Remote-enabled mode: local clients may connect directly; remote clients must match password.
    if (isLocal && !suppliedPassword) {
      return { allowed: true };
    }

    if (!room.passwordHash || !room.passwordSalt) {
      return {
        allowed: false,
        requiresPassword: true,
        reason: 'Remote access requires a configured room password.',
      };
    }

    if (!suppliedPassword) {
      return {
        allowed: false,
        requiresPassword: true,
        reason: 'Remote access password is required to connect to this stream.',
      };
    }

    const candidate = hashPassword(suppliedPassword, room.passwordSalt);
    const matches = crypto.timingSafeEqual(
      Buffer.from(candidate, 'hex'),
      Buffer.from(room.passwordHash, 'hex'),
    );

    if (!matches) {
      return {
        allowed: false,
        requiresPassword: true,
        reason: 'Incorrect remote access password.',
      };
    }

    return { allowed: true };
  }

  setPhonePresence(rawRoomId: string, connected: boolean): RoomPublicState {
    const room = this.ensureInternal(rawRoomId);
    room.phoneConnected = connected;
    if (!connected) {
      const wasActive = room.streamActive;
      room.streamActive = false;
      room.connectionState = wasActive ? 'reconnecting' : 'waiting';
    } else if (!room.streamActive && room.connectionState === 'reconnecting') {
      room.connectionState = 'waiting';
    }
    room.updatedAt = Date.now();
    return this.toPublic(room);
  }

  setDesktopCount(rawRoomId: string, count: number): RoomPublicState {
    const room = this.ensureInternal(rawRoomId);
    room.desktopCount = Math.max(0, count);
    room.updatedAt = Date.now();
    return this.toPublic(room);
  }

  updateStreamState(
    rawRoomId: string,
    patch: {
      streamActive?: boolean;
      connectionState?: StreamConnectionState;
      settings?: Partial<RoomStreamSettings>;
      lastError?: string | null;
    },
  ): RoomPublicState {
    const room = this.ensureInternal(rawRoomId);
    if (typeof patch.streamActive === 'boolean') {
      room.streamActive = patch.streamActive;
    }
    if (patch.connectionState) {
      room.connectionState = patch.connectionState;
    }
    if (patch.settings) {
      room.settings = { ...room.settings, ...patch.settings };
    }
    if (patch.lastError !== undefined) {
      room.lastError = patch.lastError;
    }
    room.updatedAt = Date.now();
    return this.toPublic(room);
  }

  private normalizeRoomId(rawRoomId: string): string {
    const clean = rawRoomId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    return clean || 'STUDIO1';
  }

  private ensureInternal(rawRoomId: string): InternalRoom {
    const roomId = this.normalizeRoomId(rawRoomId);
    if (!this.rooms.has(roomId)) {
      this.getOrCreateRoom(roomId);
    }
    return this.rooms.get(roomId)!;
  }

  private toPublic(room: InternalRoom): RoomPublicState {
    return {
      roomId: room.roomId,
      networkMode: room.networkMode,
      remotePasswordConfigured: Boolean(room.passwordHash),
      phoneConnected: room.phoneConnected,
      desktopCount: room.desktopCount,
      streamActive: room.streamActive,
      connectionState: room.connectionState,
      settings: { ...room.settings },
      lastError: room.lastError,
      updatedAt: room.updatedAt,
    };
  }
}
