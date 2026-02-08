'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;
const express = require('express');

/**
 * Start a minimal Riptide-compatible test server on a random port for WebSocket testing.
 * Replicates the WebSocket upgrade, sync, and terminal handlers from server.js,
 * using a mock PTY (echo behavior) instead of real node-pty.
 * Storage is isolated to a temp directory.
 */
async function startTestServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'riptide-ws-test-'));
  const roomsDir = path.join(tempDir, 'rooms');
  fs.mkdirSync(roomsDir, { recursive: true });
  fs.writeFileSync(path.join(roomsDir, 'rooms.json'), JSON.stringify({ rooms: [] }));

  const playbooksDir = path.join(tempDir, 'playbooks');
  fs.mkdirSync(playbooksDir, { recursive: true });

  // Patch storage paths BEFORE any storage operations
  const storage = require('../../lib/storage');
  const restorePaths = storage._setTestPaths(roomsDir, path.join(roomsDir, 'rooms.json'));
  storage.roomWorkDirCache.clear();
  storage.roomTabsCache.clear();

  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const server = http.createServer(app);

  // In-memory state (mirrors server.js)
  const sessions = new Map();
  const editLocks = new Map();
  const roomClients = new Map();
  const ptyProcesses = new Map();
  const roomPtyKeys = new Map();
  const roomLockKeys = new Map();
  const roomSessionTokens = new Map();

  const LIMITS = {
    PTY_BUFFER_BYTES: 262144,
    MAX_ALERTS: 200,
    SESSION_TTL_MS: 86400000,
    MAX_PTY_PER_ROOM: 50,
    WS_RATE_LIMIT_PER_SEC: 100,
    WS_PING_INTERVAL: 30000,
    WS_PONG_TIMEOUT: 10000,
    EDIT_LOCK_TTL: 300000,
    MAX_WS_MESSAGE_BYTES: 65536
  };

  function broadcastToRoom(roomId, event, excludeToken) {
    const clients = roomClients.get(roomId);
    if (!clients) return;
    const msg = JSON.stringify(event);
    for (const client of clients) {
      if (client.token !== excludeToken && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  function getRoomUsers(roomId) {
    const clients = roomClients.get(roomId);
    if (!clients) return [];
    return [...clients].map(c => ({ nickname: c.nickname, activeTabId: c.activeTabId || null }));
  }

  function createSession(roomId, nickname) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { roomId, nickname, connectedAt: Date.now() });
    if (!roomSessionTokens.has(roomId)) roomSessionTokens.set(roomId, new Set());
    roomSessionTokens.get(roomId).add(token);
    return token;
  }

  // --- WebSocket servers ---
  const syncWss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const termWss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  // --- Upgrade handler (mirrors server.js lines 488-525) ---
  server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    if (origin) {
      try {
        const reqOrigin = new URL(origin);
        const hostHeader = request.headers.host || '';
        const expectedHost = hostHeader.split(':')[0];
        if (reqOrigin.hostname !== expectedHost &&
            reqOrigin.hostname !== 'localhost' &&
            reqOrigin.hostname !== '127.0.0.1') {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    } else {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/ws/terminal') {
      termWss.handleUpgrade(request, socket, head, (ws) => {
        termWss.emit('connection', ws, request);
      });
    } else if (url.pathname === '/ws/sync') {
      syncWss.handleUpgrade(request, socket, head, (ws) => {
        syncWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // --- Sync handler (mirrors server.js lines 695-897) ---
  syncWss.on('connection', (ws) => {
    let clientInfo = null;
    let msgCount = 0;
    let msgResetTime = Date.now();

    ws.on('message', (raw) => {
      if (raw.length > LIMITS.MAX_WS_MESSAGE_BYTES) return;
      const now = Date.now();
      if (now - msgResetTime > 1000) { msgCount = 0; msgResetTime = now; }
      msgCount++;
      if (msgCount > LIMITS.WS_RATE_LIMIT_PER_SEC) return;

      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'auth') {
          const session = sessions.get(msg.token);
          if (!session) { ws.close(); return; }

          const initialTab = msg.activeTabId || null;
          clientInfo = { ws, nickname: session.nickname, token: msg.token, activeTabId: initialTab };
          const roomId = session.roomId;

          if (!roomClients.has(roomId)) roomClients.set(roomId, new Set());
          roomClients.get(roomId).add(clientInfo);

          ws.send(JSON.stringify({ type: 'users', users: getRoomUsers(roomId) }));

          const locks = [];
          for (const [key, lock] of editLocks) {
            if (key.startsWith(roomId + ':')) {
              const parts = key.split(':');
              locks.push({ tabId: parts[1], noteId: parts.slice(2).join(':'), nickname: lock.nickname });
            }
          }
          if (locks.length > 0) {
            ws.send(JSON.stringify({ type: 'edit-locks', locks }));
          }

          broadcastToRoom(roomId, { type: 'user-joined', nickname: session.nickname, activeTabId: initialTab }, msg.token);
        }

        if (msg.type === 'tab-switch' && clientInfo) {
          clientInfo.activeTabId = msg.tabId;
          const session = sessions.get(clientInfo.token);
          if (session) {
            broadcastToRoom(session.roomId, { type: 'tab-switch', nickname: clientInfo.nickname, tabId: msg.tabId }, clientInfo.token);
          }
        }

        if (msg.type === 'note-editing' && clientInfo) {
          const session = sessions.get(clientInfo.token);
          if (!session) return;
          const lockKey = `${session.roomId}:${msg.tabId}:${msg.noteId}`;
          const existing = editLocks.get(lockKey);
          if (existing && existing.token !== clientInfo.token) {
            if (Date.now() - existing.lockedAt > LIMITS.EDIT_LOCK_TTL) {
              editLocks.delete(lockKey);
              broadcastToRoom(session.roomId, { type: 'note-edit-done', tabId: msg.tabId, noteId: msg.noteId, nickname: existing.nickname }, clientInfo.token);
            } else {
              ws.send(JSON.stringify({ type: 'note-lock-denied', noteId: msg.noteId, lockedBy: existing.nickname }));
              return;
            }
          }
          editLocks.set(lockKey, { nickname: clientInfo.nickname, token: clientInfo.token, lockedAt: Date.now() });
          if (!roomLockKeys.has(session.roomId)) roomLockKeys.set(session.roomId, new Set());
          roomLockKeys.get(session.roomId).add(lockKey);
          broadcastToRoom(session.roomId, { type: 'note-editing', tabId: msg.tabId, noteId: msg.noteId, nickname: clientInfo.nickname }, clientInfo.token);
        }

        if (msg.type === 'note-edit-done' && clientInfo) {
          const session = sessions.get(clientInfo.token);
          if (!session) return;
          const lockKey = `${session.roomId}:${msg.tabId}:${msg.noteId}`;
          const existing = editLocks.get(lockKey);
          if (existing && existing.token === clientInfo.token) {
            editLocks.delete(lockKey);
            roomLockKeys.get(session.roomId)?.delete(lockKey);
            broadcastToRoom(session.roomId, { type: 'note-edit-done', tabId: msg.tabId, noteId: msg.noteId, nickname: clientInfo.nickname }, clientInfo.token);
          }
        }

        if (msg.type === 'finding-flagged' && typeof msg.preview === 'string' && clientInfo) {
          const session = sessions.get(clientInfo.token);
          if (!session) return;
          const sanitize = (val, maxLen) => (typeof val === 'string' ? val : '').substring(0, maxLen);
          const alert = {
            id: crypto.randomBytes(12).toString('hex'),
            timestamp: new Date().toISOString(),
            nickname: clientInfo.nickname,
            context: sanitize(msg.context, 100),
            title: sanitize(msg.title, 200),
            preview: sanitize(msg.preview, 200)
          };
          storage.atomicUpdateAlerts(session.roomId, (alerts) => {
            alerts.push(alert);
            while (alerts.length > LIMITS.MAX_ALERTS) alerts.shift();
            return true;
          }).catch(_err => {});
          broadcastToRoom(session.roomId, { type: 'finding-flagged', ...alert }, clientInfo.token);
        }
      } catch (_err) {}
    });

    ws.on('close', () => {
      if (!clientInfo) return;
      const session = sessions.get(clientInfo.token);
      if (!session) return;
      const roomId = session.roomId;

      for (const [key, lock] of editLocks) {
        if (lock.token === clientInfo.token) {
          editLocks.delete(key);
          roomLockKeys.get(roomId)?.delete(key);
          const parts = key.split(':');
          broadcastToRoom(roomId, { type: 'note-edit-done', tabId: parts[1], noteId: parts.slice(2).join(':'), nickname: clientInfo.nickname }, clientInfo.token);
        }
      }

      const clients = roomClients.get(roomId);
      if (clients) {
        clients.delete(clientInfo);
        if (clients.size === 0) roomClients.delete(roomId);
      }
      broadcastToRoom(roomId, { type: 'user-left', nickname: clientInfo.nickname }, clientInfo.token);
    });
  });

  // --- Terminal handler (mock PTY — echoes input back) ---
  termWss.on('connection', (ws) => {
    let ptyKey = null;
    let msgCount = 0;
    let msgResetTime = Date.now();

    ws.on('message', async (raw) => {
      if (raw.length > LIMITS.MAX_WS_MESSAGE_BYTES) return;
      const now = Date.now();
      if (now - msgResetTime > 1000) { msgCount = 0; msgResetTime = now; }
      msgCount++;
      if (msgCount > LIMITS.WS_RATE_LIMIT_PER_SEC) return;

      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'init') {
          const session = sessions.get(msg.token);
          if (!session) { ws.close(); return; }

          const roomId = session.roomId;
          const tabId = msg.tabId;
          const subTabId = msg.subTabId || '0';
          ptyKey = roomId + ':' + tabId + ':' + subTabId;

          const data = await storage.readRoomTabs(roomId);
          if (!data || !data.tabs.find(t => t.id === tabId)) { ws.close(); return; }

          if (!ptyProcesses.has(ptyKey)) {
            let roomPtyCount = 0;
            const roomPrefix = roomId + ':';
            for (const key of ptyProcesses.keys()) {
              if (key.startsWith(roomPrefix)) roomPtyCount++;
            }
            if (roomPtyCount >= LIMITS.MAX_PTY_PER_ROOM) {
              ws.send(JSON.stringify({ error: 'PTY limit reached for this room' }));
              ws.close();
              return;
            }

            // Mock PTY: echoes input back as output
            const dataHandlers = [];
            const exitHandlers = [];
            const mockPty = {
              write(d) { for (const h of dataHandlers) h(d); },
              resize() {},
              kill() { for (const h of exitHandlers) h({ exitCode: 0 }); },
              onData(h) { dataHandlers.push(h); },
              onExit(h) { exitHandlers.push(h); }
            };

            const entry = { pty: mockPty, clients: new Set(), buffer: [], bufferSize: 0 };
            ptyProcesses.set(ptyKey, entry);
            if (!roomPtyKeys.has(roomId)) roomPtyKeys.set(roomId, new Set());
            roomPtyKeys.get(roomId).add(ptyKey);

            const capturedKey = ptyKey;
            mockPty.onData((output) => {
              const e = ptyProcesses.get(capturedKey);
              if (!e) return;
              e.buffer.push(output);
              e.bufferSize += output.length;
              while (e.bufferSize > LIMITS.PTY_BUFFER_BYTES && e.buffer.length > 1) {
                e.bufferSize -= e.buffer.shift().length;
              }
              for (const client of e.clients) {
                if (client.readyState === WebSocket.OPEN) client.send(output);
              }
            });

            mockPty.onExit(() => {
              const e = ptyProcesses.get(capturedKey);
              if (!e) return;
              ptyProcesses.delete(capturedKey);
              const parts = capturedKey.split(':');
              roomPtyKeys.get(parts[0])?.delete(capturedKey);
              for (const client of e.clients) {
                if (client.readyState === WebSocket.OPEN) client.close();
              }
            });
          }

          ptyProcesses.get(ptyKey).clients.add(ws);
          const ptyEntry = ptyProcesses.get(ptyKey);
          if (ptyEntry.buffer.length > 0) {
            ws.send(ptyEntry.buffer.join(''));
          }
          return;
        }

        if (!ptyKey || !ptyProcesses.has(ptyKey)) return;
        const entry = ptyProcesses.get(ptyKey);

        switch (msg.type) {
          case 'input': entry.pty.write(msg.data); break;
          case 'resize': entry.pty.resize(msg.cols, msg.rows); break;
        }
      } catch (_err) {}
    });

    ws.on('close', () => {
      if (ptyKey && ptyProcesses.has(ptyKey)) {
        ptyProcesses.get(ptyKey).clients.delete(ws);
      }
    });
  });

  // Start on random port
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}`;

  return {
    server, app, port, baseUrl, wsUrl,
    storage, sessions, editLocks, roomClients, ptyProcesses, roomPtyKeys, roomLockKeys, roomSessionTokens,
    LIMITS, createSession, broadcastToRoom,
    tempDir, restorePaths,

    /** Create a room with a workDir and return { roomId, token, workDir } */
    async createRoom(name, nickname) {
      const roomId = crypto.randomBytes(4).toString('hex');
      const workDir = path.join(tempDir, 'wd-' + roomId);
      fs.mkdirSync(workDir, { recursive: true });

      await storage.atomicUpdateRooms((data) => {
        data.rooms.push({ id: roomId, name: name || 'TestRoom', passwordHash: null, workDir, creator: nickname || 'tester' });
      });
      await storage.initRoom(roomId);

      const token = createSession(roomId, nickname || 'tester');
      return { roomId, token, workDir };
    },

    /** Connect to /ws/sync with proper Origin header */
    connectSync(opts = {}) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}/ws/sync`, {
          headers: { Origin: opts.origin || baseUrl }
        });
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
      });
    },

    /** Connect to /ws/terminal with proper Origin header */
    connectTerminal(opts = {}) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}/ws/terminal`, {
          headers: { Origin: opts.origin || baseUrl }
        });
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
      });
    },

    /** Connect to an arbitrary path with proper Origin header */
    connectPath(wsPath, opts = {}) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}${wsPath}`, {
          headers: { Origin: opts.origin || baseUrl }
        });
        const timer = setTimeout(() => {
          ws.removeAllListeners();
          reject(new Error('Connection timed out'));
        }, 2000);
        ws.on('open', () => { clearTimeout(timer); resolve(ws); });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      });
    },

    /** Connect without any Origin header */
    connectNoOrigin(wsPath) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}${wsPath}`, {
          headers: {} // explicitly empty, ws package won't add Origin
        });
        const timer = setTimeout(() => {
          ws.removeAllListeners();
          reject(new Error('Connection timed out'));
        }, 2000);
        ws.on('open', () => { clearTimeout(timer); resolve(ws); });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      });
    },

    /** Wait for a specific message type from a WebSocket */
    waitForMessage(ws, type, timeout = 3000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.removeListener('message', handler);
          reject(new Error(`Timeout waiting for message type "${type}"`));
        }, timeout);
        const handler = (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === type) {
              clearTimeout(timer);
              ws.removeListener('message', handler);
              resolve(msg);
            }
          } catch (_e) {}
        };
        ws.on('message', handler);
      });
    },

    /** Collect next N messages from a WebSocket (or as many as arrive before timeout) */
    collectMessages(ws, count, timeout = 3000) {
      return new Promise((resolve) => {
        const msgs = [];
        const timer = setTimeout(() => {
          ws.removeListener('message', handler);
          resolve(msgs);
        }, timeout);
        const handler = (data) => {
          try {
            msgs.push(JSON.parse(data.toString()));
            if (msgs.length >= count) {
              clearTimeout(timer);
              ws.removeListener('message', handler);
              resolve(msgs);
            }
          } catch (_e) {}
        };
        ws.on('message', handler);
      });
    },

    /** Wait for a WebSocket to close */
    waitForClose(ws, timeout = 3000) {
      return new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error('Timeout waiting for WS close')), timeout);
        ws.on('close', () => { clearTimeout(timer); resolve(); });
      });
    },

    /** Small delay utility */
    delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    /** Shutdown the test server and clean up */
    async shutdown() {
      for (const ws of syncWss.clients) ws.terminate();
      for (const ws of termWss.clients) ws.terminate();

      for (const entry of ptyProcesses.values()) {
        entry.pty.kill();
      }
      ptyProcesses.clear();

      await new Promise(resolve => server.close(resolve));

      restorePaths();
      storage.roomWorkDirCache.clear();
      storage.roomTabsCache.clear();

      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

module.exports = { startTestServer };
