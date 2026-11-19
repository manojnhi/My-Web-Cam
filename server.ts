import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { SessionStore } from './server/sessionStore.ts';
import { isLocalNetworkHost, truncateWsCloseReason } from './src/utils/streamConfig.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

interface PeerClient {
  ws: WebSocket;
  roomId: string;
  role: 'phone' | 'desktop';
  clientId: string;
}

function getLocalLanIps(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        ips.push(entry.address);
      }
    }
  }
  return ips;
}

function addDirectoryToZip(zip: JSZip, rootDir: string, currentDir = rootDir): void {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
      continue;
    }
    const fullPath = path.join(currentDir, entry.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      addDirectoryToZip(zip, rootDir, fullPath);
    } else {
      zip.file(relPath, fs.readFileSync(fullPath), { createFolders: false });
    }
  }
}

function extractClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '127.0.0.1';
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  const store = new SessionStore();
  const roomPeers = new Map<string, Set<PeerClient>>();

  const getRoomPeerSet = (roomId: string): Set<PeerClient> => {
    const clean = roomId.trim().toUpperCase() || 'STUDIO1';
    if (!roomPeers.has(clean)) {
      roomPeers.set(clean, new Set());
    }
    return roomPeers.get(clean)!;
  };

  const broadcastRoomState = (roomId: string): void => {
    const state = store.getOrCreateRoom(roomId);
    const payload = JSON.stringify({ type: 'room:state', state });
    for (const peer of getRoomPeerSet(state.roomId)) {
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(payload);
      }
    }
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, port: PORT, localIps: getLocalLanIps() });
  });

  app.get('/api/network-info', (req, res) => {
    const hostHeader = req.headers.host ?? `localhost:${PORT}`;
    const localIps = getLocalLanIps();
    const clientIp = extractClientIp(req);
    res.json({
      localIps,
      clientIp,
      isClientLocal: isLocalNetworkHost(clientIp) || isLocalNetworkHost(hostHeader),
      suggestedLanUrl: localIps[0] ? `http://${localIps[0]}:${PORT}` : `http://${hostHeader}`,
    });
  });

  app.get('/api/rooms/:roomId', (req, res) => {
    const state = store.getOrCreateRoom(req.params.roomId);
    res.json(state);
  });

  app.post('/api/rooms/:roomId/remote-access', (req, res) => {
    const { enabled, password } = (req.body ?? {}) as { enabled?: boolean; password?: string };
    const roomId = req.params.roomId;

    if (!enabled) {
      const state = store.disableRemoteAccess(roomId);
      broadcastRoomState(roomId);
      res.json({ ok: true, state });
      return;
    }

    const result = store.enableRemoteAccess(roomId, String(password ?? ''));
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    broadcastRoomState(roomId);
    res.json({ ok: true, state: result.state });
  });

  app.post('/api/rooms/:roomId/verify-password', (req, res) => {
    const { password } = (req.body ?? {}) as { password?: string };
    const clientIp = extractClientIp(req);
    const check = store.canJoinPeer(req.params.roomId, clientIp, password, false);
    if (!check.allowed) {
      res.status(403).json({ ok: false, error: check.reason, requiresPassword: check.requiresPassword });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/download/android-source.zip', async (_req, res) => {
    const androidDir = path.resolve(__dirname, 'native/android');
    if (!fs.existsSync(androidDir)) {
      res.status(404).json({ error: 'Android source directory not found.' });
      return;
    }
    const zip = new JSZip();
    addDirectoryToZip(zip, androidDir);
    const workflowPath = path.resolve(__dirname, '.github/workflows/build-releases.yml');
    if (fs.existsSync(workflowPath)) {
      zip.file('.github/workflows/build-releases.yml', fs.readFileSync(workflowPath), {
        createFolders: false,
      });
    }
    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      platform: 'DOS',
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="my-web-cam-android-source.zip"');
    res.end(buffer);
  });

  app.get('/api/download/desktop-source.zip', async (_req, res) => {
    const desktopDir = path.resolve(__dirname, 'native/desktop');
    if (!fs.existsSync(desktopDir)) {
      res.status(404).json({ error: 'Desktop source directory not found.' });
      return;
    }
    const zip = new JSZip();
    addDirectoryToZip(zip, desktopDir);
    const workflowPath = path.resolve(__dirname, '.github/workflows/build-releases.yml');
    if (fs.existsSync(workflowPath)) {
      zip.file('.github/workflows/build-releases.yml', fs.readFileSync(workflowPath), {
        createFolders: false,
      });
    }
    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      platform: 'DOS',
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="my-web-cam-desktop-source.zip"');
    res.end(buffer);
  });

  app.get('/api/download/full-project.zip', async (_req, res) => {
    const zip = new JSZip();
    const rootFiles = ['package.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'server.ts', 'metadata.json'];
    for (const file of rootFiles) {
      const full = path.resolve(__dirname, file);
      if (fs.existsSync(full)) {
        zip.file(file, fs.readFileSync(full), { createFolders: false });
      }
    }
    const folders = ['src', 'server', 'native', '.github'];
    for (const folder of folders) {
      const dirPath = path.resolve(__dirname, folder);
      if (fs.existsSync(dirPath)) {
        const addSub = (cur: string) => {
          for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
            const fp = path.join(cur, entry.name);
            const rel = path.relative(__dirname, fp).replace(/\\/g, '/');
            if (entry.isDirectory()) {
              addSub(fp);
            } else {
              zip.file(rel, fs.readFileSync(fp), { createFolders: false });
            }
          }
        };
        addSub(dirPath);
      }
    }
    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      platform: 'DOS',
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="my-web-cam-github-project.zip"');
    res.end(buffer);
  });

  app.get('/api/download/virtual-cam-bridge.py', (_req, res) => {
    const bridgePath = path.resolve(__dirname, 'native/desktop/virtual-cam/bridge.py');
    if (!fs.existsSync(bridgePath)) {
      res.status(404).json({ error: 'Virtual cam bridge script not found.' });
      return;
    }
    res.setHeader('Content-Type', 'text/x-python');
    res.setHeader('Content-Disposition', 'attachment; filename="my_web_cam_virtual_bridge.py"');
    res.sendFile(bridgePath);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/ws', `http://${req.headers.host ?? 'localhost'}`);
    const rawRoomId = url.searchParams.get('room') ?? 'STUDIO1';
    const role = url.searchParams.get('role') === 'phone' ? 'phone' : 'desktop';
    const suppliedPassword = url.searchParams.get('password') ?? undefined;
    const simulateRemote = url.searchParams.get('simulateRemote') === '1';

    const roomId = store.getOrCreateRoom(rawRoomId).roomId;
    const clientIp = simulateRemote ? '203.0.113.50' : extractClientIp(req);
    const isSameOriginLocal = !simulateRemote && (isLocalNetworkHost(clientIp) || Boolean(req.headers.host?.includes('run.app')));

    const accessCheck = store.canJoinPeer(roomId, clientIp, suppliedPassword, isSameOriginLocal);
    if (!accessCheck.allowed) {
      ws.send(
        JSON.stringify({
          type: 'auth:error',
          error: accessCheck.reason,
          requiresPassword: accessCheck.requiresPassword,
        }),
      );
      ws.close(4001, truncateWsCloseReason(accessCheck.reason, 120));
      return;
    }

    const clientId = `${role}-${Math.random().toString(36).slice(2, 9)}`;
    const peer: PeerClient = { ws, roomId, role, clientId };
    const peers = getRoomPeerSet(roomId);
    peers.add(peer);

    if (role === 'phone') {
      store.setPhonePresence(roomId, true);
    } else {
      const desktopCount = Array.from(peers).filter((p) => p.role === 'desktop').length;
      store.setDesktopCount(roomId, desktopCount);
    }

    ws.send(JSON.stringify({ type: 'welcome', clientId, state: store.getOrCreateRoom(roomId) }));
    broadcastRoomState(roomId);

    // If desktop joined while phone is already streaming, ask phone to send a WebRTC offer
    if (role === 'desktop') {
      const state = store.getOrCreateRoom(roomId);
      if (state.phoneConnected && state.streamActive) {
        for (const p of peers) {
          if (p.role === 'phone' && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify({ type: 'stream:request-offer', targetId: clientId }));
          }
        }
      }
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Relay binary video frames (fallback stream for restricted networks or Python virtual-cam bridge)
        for (const p of peers) {
          if (p !== peer && p.role === 'desktop' && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(data, { binary: true });
          }
        }
        return;
      }

      try {
        const msg = JSON.parse(data.toString()) as {
          type: string;
          targetId?: string;
          sdp?: unknown;
          candidate?: unknown;
          streamActive?: boolean;
          connectionState?: 'waiting' | 'connecting' | 'live' | 'reconnecting' | 'error';
          settings?: Record<string, unknown>;
          lastError?: string | null;
        };

        if (msg.type === 'phone:state' && role === 'phone') {
          store.updateStreamState(roomId, {
            streamActive: msg.streamActive,
            connectionState: msg.connectionState,
            settings: msg.settings,
            lastError: msg.lastError,
          });
          broadcastRoomState(roomId);
          return;
        }

        if (
          msg.type === 'webrtc:offer' ||
          msg.type === 'webrtc:answer' ||
          msg.type === 'webrtc:ice' ||
          msg.type === 'stream:request-offer'
        ) {
          const outbound = JSON.stringify({ ...msg, senderId: clientId });
          for (const p of peers) {
            if (p === peer || p.ws.readyState !== WebSocket.OPEN) continue;
            if (msg.targetId && msg.targetId !== 'broadcast' && p.clientId !== msg.targetId) continue;
            p.ws.send(outbound);
          }
        }
      } catch {
        // Ignore malformed JSON packets
      }
    });

    ws.on('close', () => {
      peers.delete(peer);
      if (role === 'phone') {
        const hasOtherPhone = Array.from(peers).some((p) => p.role === 'phone');
        if (!hasOtherPhone) {
          store.setPhonePresence(roomId, false);
        }
      } else {
        const desktopCount = Array.from(peers).filter((p) => p.role === 'desktop').length;
        store.setDesktopCount(roomId, desktopCount);
      }
      broadcastRoomState(roomId);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`My Web Cam server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start My Web Cam server:', err);
  process.exit(1);
});
