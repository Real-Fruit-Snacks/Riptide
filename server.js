const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { execSync } = require('child_process');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');
const AdmZip = require('adm-zip');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const storage = require('./lib/storage');
const helpers = require('./lib/helpers');

// --- Tunable limits ---
const LIMITS = {
  PTY_BUFFER_BYTES: 262144,
  MAX_ALERTS: 200,
  MAX_SCRATCH_NOTES: 500,
  MAX_HISTORY_ENTRIES: 100,
  SESSION_TTL_MS: 86400000,
  MAX_NOTE_BYTES: 1048576,
  MAX_TAB_NAME: 100,
  MAX_ROOM_NAME: 100,
  MAX_NICKNAME: 30,
  MAX_FILENAME_LENGTH: 200,
  MAX_PTY_PER_ROOM: 50,
  WS_RATE_LIMIT_PER_SEC: 100,
  WS_PING_INTERVAL: 30000,
  WS_PONG_TIMEOUT: 10000,
  EDIT_LOCK_TTL: 300000,
  MAX_AUDIT_ENTRIES: 200,
  MAX_CREDENTIAL_FIELD_LENGTH: 2000,
  MAX_COMMAND_LENGTH: 50000,
  MAX_SCRATCH_NOTE_LENGTH: 50000,
  MAX_WS_MESSAGE_BYTES: 65536,
  MAX_RECORDING_NAME: 100,
  MAX_CHAT_MESSAGES: 500,
  MAX_CHAT_MESSAGE_LENGTH: 5000
};

// --- Credential validation helper (extracted to lib/helpers.js) ---
// Wrap to bind maxFieldLength from LIMITS
function validateCredentialFields(req, res, opts = {}) {
  return helpers.validateCredentialFields(req, res, { ...opts, maxFieldLength: LIMITS.MAX_CREDENTIAL_FIELD_LENGTH });
}

// --- Allowed workDir base directory ---
const ALLOWED_WORKDIR_BASE = process.env.RIPTIDE_DATA_ROOT || path.join(__dirname, 'rooms');
if (!process.env.RIPTIDE_DATA_ROOT) {
  console.info(`INFO: RIPTIDE_DATA_ROOT not set. Using default workDir base: ${ALLOWED_WORKDIR_BASE}`);
}

const app = express();
const PORT = process.env.PORT || 3000;

// --- SSL / HTTPS ---
const CERTS_DIR = path.join(__dirname, 'certs');
const SSL_KEY = process.env.SSL_KEY || path.join(CERTS_DIR, 'server.key');
const SSL_CERT = process.env.SSL_CERT || path.join(CERTS_DIR, 'server.cert');

function ensureCerts() {
  if (fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT)) return;
  fs.mkdirSync(CERTS_DIR, { recursive: true });
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${SSL_KEY}" -out "${SSL_CERT}" -days 365 -nodes -subj "/CN=Riptide/O=Riptide/C=US"`,
      { stdio: 'pipe' }
    );
    console.log('Generated self-signed SSL certificate in certs/');
  } catch (err) {
    console.error('Failed to generate SSL certificate:', err.message);
    console.log('Falling back to HTTP. Install openssl or set NO_SSL=1');
  }
}

let server;
if (process.env.NO_SSL) {
  server = http.createServer(app);
} else {
  ensureCerts();
  if (fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT)) {
    server = https.createServer({
      key: fs.readFileSync(SSL_KEY),
      cert: fs.readFileSync(SSL_CERT),
      minVersion: 'TLSv1.2'
    }, app);
  } else {
    server = http.createServer(app);
  }
}

// --- Middleware ---
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  frameguard: { action: 'deny' }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' }
});

const apiMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS'
});
app.use('/api/', apiMutationLimiter);

// --- Static file serving ---
app.use(express.static(path.join(__dirname, 'public')));

app.use('/vendor/xterm', express.static(
  path.join(__dirname, 'node_modules/@xterm/xterm')
));
app.use('/vendor/xterm-addon-fit', express.static(
  path.join(__dirname, 'node_modules/@xterm/addon-fit')
));
app.use('/vendor/xterm-addon-web-links', express.static(
  path.join(__dirname, 'node_modules/@xterm/addon-web-links')
));
app.use('/vendor/marked', express.static(
  path.join(__dirname, 'node_modules/marked')
));
app.use('/vendor/prism', express.static(
  path.join(__dirname, 'node_modules/prismjs')
));
app.use('/vendor/dompurify', express.static(
  path.join(__dirname, 'node_modules/dompurify')
));

// --- Room Infrastructure ---
const PLAYBOOKS_DIR = path.join(__dirname, 'playbooks');

// --- File upload storage ---
const fileUploadStorage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    try {
      const tabDir = await storage.resolveTabDataDir(req.roomId, req.params.tabId);
      const filesDir = path.join(tabDir, 'files');
      await fsp.mkdir(filesDir, { recursive: true });
      cb(null, filesDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    // Preserve original filename, sanitized
    const safe = storage.sanitizeForFilesystem(file.originalname);
    cb(null, safe);
  }
});
const fileUpload = multer({
  storage: fileUploadStorage,
  limits: { fileSize: 100 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    // Block executable and dangerous MIME types
    const blocked = [
      'application/x-executable',
      'application/x-dosexec',
      'application/x-msdownload',
      'application/x-msdos-program',
      'application/vnd.microsoft.portable-executable'
    ];
    if (blocked.includes(file.mimetype)) {
      cb(new Error('File type not allowed'));
    } else {
      cb(null, true);
    }
  }
});

// --- Playbook Library ---
// parseFrontmatter extracted to lib/helpers.js
const parseFrontmatter = helpers.parseFrontmatter;


// --- Password Hashing (extracted to lib/helpers.js) ---
const hashPassword = helpers.hashPassword;
const verifyPassword = helpers.verifyPassword;

// --- Session Management ---
const sessions = new Map(); // token -> { roomId, nickname, connectedAt }
const SESSION_MAX_AGE = LIMITS.SESSION_TTL_MS;

// Secondary indexes for O(1) room cleanup
const roomPtyKeys = new Map();    // roomId -> Set<ptyKey>
const roomLockKeys = new Map();   // roomId -> Set<lockKey>
const roomSessionTokens = new Map(); // roomId -> Set<token>

function createSession(roomId, nickname) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { roomId, nickname, connectedAt: Date.now() });
  // Maintain secondary index
  if (!roomSessionTokens.has(roomId)) roomSessionTokens.set(roomId, new Set());
  roomSessionTokens.get(roomId).add(token);
  return token;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.connectedAt > SESSION_MAX_AGE) {
      sessions.delete(token);
      // Maintain secondary index
      roomSessionTokens.get(session.roomId)?.delete(token);
    }
  }
}, 60 * 60 * 1000); // Clean up every hour

// --- Sync Infrastructure ---
const syncWss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
const roomClients = new Map(); // roomId -> Set<{ ws, nickname, token, activeTabId }>
const editLocks = new Map(); // "roomId:tabId:noteId" -> { nickname, token, lockedAt }
const ptyProcesses = new Map(); // "roomId:tabId:subTabId" -> { pty, clients: Set<ws> }

// Periodic stale edit lock cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, lock] of editLocks) {
    if (now - lock.lockedAt > LIMITS.EDIT_LOCK_TTL) {
      editLocks.delete(key);
      const parts = key.split(':');
      const roomId = parts[0];
      const tabId = parts[1];
      const noteId = parts.slice(2).join(':');
      // Maintain secondary index
      roomLockKeys.get(roomId)?.delete(key);
      broadcastToRoom(roomId, {
        type: 'note-edit-done',
        tabId,
        noteId,
        nickname: lock.nickname
      });
    }
  }
}, 60000); // Every minute

function broadcastToRoom(roomId, event, excludeToken) {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  const msg = JSON.stringify(event);
  for (const client of clients) {
    if (client.token !== excludeToken && client.ws.readyState === 1) {
      client.ws.send(msg);
    }
  }
}

function getRoomUserCount(roomId) {
  const clients = roomClients.get(roomId);
  return clients ? clients.size : 0;
}

function getRoomUsers(roomId) {
  const clients = roomClients.get(roomId);
  if (!clients) return [];
  return [...clients].map(c => ({ nickname: c.nickname, activeTabId: c.activeTabId || null }));
}

// --- Short-lived image tokens (for <img> src authentication) ---
const IMAGE_TOKEN_SECRET = crypto.randomBytes(32);
const IMAGE_TOKEN_MAX_AGE = 5 * 60 * 1000; // 5 minutes

function generateImageToken(roomId) {
  const exp = Date.now() + IMAGE_TOKEN_MAX_AGE;
  const payload = Buffer.from(JSON.stringify({ roomId, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', IMAGE_TOKEN_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function validateImageToken(tokenStr) {
  try {
    const [payload, sig] = (tokenStr || '').split('.');
    if (!payload || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', IMAGE_TOKEN_SECRET).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

// --- Auth Middleware ---
function requireRoom(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const session = sessions.get(token);
  if (!session) {
    // Check for short-lived image token (used by <img> src)
    if (req.query.token) {
      const imgData = validateImageToken(req.query.token);
      if (imgData) {
        req.roomId = imgData.roomId;
        req.nickname = '_image_';
        req.token = '';
        return next();
      }
    }
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (Date.now() - session.connectedAt > SESSION_MAX_AGE) {
    sessions.delete(token);
    // Maintain secondary index
    roomSessionTokens.get(session.roomId)?.delete(token);
    return res.status(401).json({ error: 'Session expired' });
  }
  req.roomId = session.roomId;
  req.nickname = session.nickname;
  req.token = token;
  next();
}

app.get('/api/image-token', requireRoom, (req, res) => {
  const token = generateImageToken(req.roomId);
  res.json({ token, expiresIn: IMAGE_TOKEN_MAX_AGE });
});

// --- Room-scoped validation ---
async function validateTabId(req, res, next) {
  const tabId = req.params.tabId;
  if (!tabId || !/^[a-f0-9]{8,16}$/.test(tabId)) {
    return res.status(400).json({ error: 'Invalid tab ID' });
  }
  const data = await storage.readRoomTabs(req.roomId);
  if (!data || !data.tabs.find(t => t.id === tabId)) {
    return res.status(404).json({ error: 'Tab not found' });
  }
  req.tabsData = data;
  req.tabNotesDir = await storage.resolveTabDataDir(req.roomId, tabId);
  next();
}

function validateNoteId(req, res, next) {
  const id = req.params.noteId;
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid note ID' });
  }
  const fullPath = path.resolve(req.tabNotesDir, id + '.md');
  if (!fullPath.startsWith(path.resolve(req.tabNotesDir))) {
    return res.status(400).json({ error: 'Invalid note path' });
  }
  req.notePath = fullPath;
  next();
}

// --- Route Modules ---
const routeCtx = {
  storage,
  LIMITS,
  sessions,
  editLocks,
  roomClients,
  ptyProcesses,
  roomPtyKeys,
  roomLockKeys,
  roomSessionTokens,
  broadcastToRoom,
  getRoomUserCount,
  getRoomUsers,
  hashPassword,
  verifyPassword,
  createSession,
  generateImageToken,
  validateCredentialFields,
  requireRoom,
  validateTabId,
  validateNoteId,
  authLimiter,
  fileUpload,
  PLAYBOOKS_DIR,
  parseFrontmatter,
  ALLOWED_WORKDIR_BASE,
  AdmZip,
};

app.use('/api', require('./routes/rooms')(routeCtx));
app.use('/api', require('./routes/tabs')(routeCtx));
app.use('/api', require('./routes/history')(routeCtx));
app.use('/api', require('./routes/scratch-notes')(routeCtx));
app.use('/api', require('./routes/credentials')(routeCtx));
app.use('/api', require('./routes/variables')(routeCtx));
app.use('/api', require('./routes/audit')(routeCtx));
app.use('/api', require('./routes/notes')(routeCtx));
app.use('/api', require('./routes/session')(routeCtx));
app.use('/api', require('./routes/playbooks')(routeCtx));
app.use('/api', require('./routes/alerts')(routeCtx));
app.use('/api', require('./routes/files')(routeCtx));
app.use('/api', require('./routes/recordings')(routeCtx));
app.use('/api', require('./routes/knowledge')(routeCtx));
app.use('/api', require('./routes/chat')(routeCtx));

// --- WebSocket: Terminal (room-scoped PTY) ---
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin;
  if (origin) {
    try {
      const reqOrigin = new URL(origin);
      const hostHeader = request.headers.host || '';
      const expectedHost = hostHeader.split(':')[0];
      // Allow if origin hostname matches the Host header hostname
      if (reqOrigin.hostname !== expectedHost && reqOrigin.hostname !== 'localhost' && reqOrigin.hostname !== '127.0.0.1') {
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
    // Reject connections with no Origin header
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/ws/terminal') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (url.pathname === '/ws/sync') {
    syncWss.handleUpgrade(request, socket, head, (ws) => {
      syncWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  let ptyKey = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let msgCount = 0;
  let msgResetTime = Date.now();

  ws.on('message', async (raw) => {
    // Size check
    if (raw.length > LIMITS.MAX_WS_MESSAGE_BYTES) return;
    // Rate limiting
    const now = Date.now();
    if (now - msgResetTime > 1000) {
      msgCount = 0;
      msgResetTime = now;
    }
    msgCount++;
    if (msgCount > LIMITS.WS_RATE_LIMIT_PER_SEC) return;

    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'init') {
        // Authenticate via token
        const session = sessions.get(msg.token);
        if (!session) {
          ws.close();
          return;
        }

        const roomId = session.roomId;
        const tabId = msg.tabId;
        const subTabId = msg.subTabId || '0';
        ptyKey = roomId + ':' + tabId + ':' + subTabId;

        // Validate that the tab exists in this room
        const data = await storage.readRoomTabs(roomId);
        if (!data || !data.tabs.find(t => t.id === tabId)) {
          ws.close();
          return;
        }

        if (!ptyProcesses.has(ptyKey)) {
          // Check PTY limit per room using secondary index
          const roomPtyCount = roomPtyKeys.get(roomId)?.size || 0;
          if (roomPtyCount >= LIMITS.MAX_PTY_PER_ROOM) {
            ws.send(JSON.stringify({ error: 'PTY limit reached for this room' }));
            ws.close();
            return;
          }

          const shell = process.env.SHELL || '/bin/bash';
          const safeEnv = {
            TERM: 'xterm-256color',
            HOME: process.env.HOME || '/root',
            USER: process.env.USER || 'root',
            SHELL: shell,
            PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            LANG: process.env.LANG || 'en_US.UTF-8',
            COLORTERM: 'truecolor'
          };
          const ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-256color',
            cols: Math.max(1, parseInt(msg.cols) || 80),
            rows: Math.max(1, parseInt(msg.rows) || 24),
            cwd: process.env.HOME || '/root',
            env: safeEnv
          });

          const entry = { pty: ptyProcess, clients: new Set(), buffer: [], bufferSize: 0 };
          ptyProcesses.set(ptyKey, entry);
          // Maintain secondary index
          if (!roomPtyKeys.has(roomId)) roomPtyKeys.set(roomId, new Set());
          roomPtyKeys.get(roomId).add(ptyKey);

          const capturedKey = ptyKey;
          ptyProcess.onData((output) => {
            const e = ptyProcesses.get(capturedKey);
            if (!e) return;

            // Buffer output for late-joining clients
            const MAX_BUFFER_SIZE = LIMITS.PTY_BUFFER_BYTES;
            e.buffer.push(output);
            e.bufferSize += output.length;
            while (e.bufferSize > MAX_BUFFER_SIZE && e.buffer.length > 1) {
              e.bufferSize -= e.buffer.shift().length;
            }

            for (const client of e.clients) {
              if (client.readyState === 1) client.send(output);
            }
          });

          ptyProcess.onExit(() => {
            const e = ptyProcesses.get(capturedKey);
            if (!e) return;
            ptyProcesses.delete(capturedKey);
            // Maintain secondary index
            const parts = capturedKey.split(':');
            roomPtyKeys.get(parts[0])?.delete(capturedKey);
            for (const client of e.clients) {
              if (client.readyState === 1) client.close();
            }
          });
        }

        ptyProcesses.get(ptyKey).clients.add(ws);

        // Replay buffered output to the new client
        const ptyEntry = ptyProcesses.get(ptyKey);
        if (ptyEntry.buffer.length > 0) {
          const buffered = ptyEntry.buffer.join('');
          ws.send(buffered);
        }

        return;
      }

      if (!ptyKey || !ptyProcesses.has(ptyKey)) return;
      const entry = ptyProcesses.get(ptyKey);

      switch (msg.type) {
        case 'input':
          entry.pty.write(msg.data);
          break;
        case 'resize':
          entry.pty.resize(
            Math.max(1, parseInt(msg.cols) || 80),
            Math.max(1, parseInt(msg.rows) || 24)
          );
          break;
      }
    } catch (err) {
      if (err.message !== 'Unexpected end of JSON input' && err.message !== 'Unexpected token') {
        console.error('[terminal-ws] message error:', err.message);
      }
    }
  });

  ws.on('close', () => {
    if (ptyKey && ptyProcesses.has(ptyKey)) {
      const entry = ptyProcesses.get(ptyKey);
      entry.clients.delete(ws);
      // Don't delete from index here - only when PTY exits or room cleanup
    }
  });
});

// Terminal WebSocket heartbeat
const terminalHeartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, LIMITS.WS_PING_INTERVAL);

wss.on('close', () => clearInterval(terminalHeartbeat));

// --- WebSocket: Sync ---

syncWss.on('connection', (ws) => {
  let clientInfo = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let msgCount = 0;
  let msgResetTime = Date.now();

  ws.on('message', (raw) => {
    // Size check
    if (raw.length > LIMITS.MAX_WS_MESSAGE_BYTES) return;
    // Rate limiting
    const now = Date.now();
    if (now - msgResetTime > 1000) {
      msgCount = 0;
      msgResetTime = now;
    }
    msgCount++;
    if (msgCount > LIMITS.WS_RATE_LIMIT_PER_SEC) return;

    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'auth') {
        const session = sessions.get(msg.token);
        if (!session) {
          ws.close();
          return;
        }

        const initialTab = msg.activeTabId || null;
        clientInfo = { ws, nickname: session.nickname, token: msg.token, activeTabId: initialTab };
        const roomId = session.roomId;

        if (!roomClients.has(roomId)) {
          roomClients.set(roomId, new Set());
        }
        roomClients.get(roomId).add(clientInfo);

        // Send current user list to new client
        ws.send(JSON.stringify({
          type: 'users',
          users: getRoomUsers(roomId)
        }));

        // Send current edit locks for this room
        const locks = [];
        for (const [key, lock] of editLocks) {
          if (key.startsWith(roomId + ':')) {
            const parts = key.split(':');
            locks.push({
              tabId: parts[1],
              noteId: parts.slice(2).join(':'),
              nickname: lock.nickname
            });
          }
        }
        if (locks.length > 0) {
          ws.send(JSON.stringify({ type: 'edit-locks', locks }));
        }

        // Broadcast join to others
        broadcastToRoom(roomId, {
          type: 'user-joined',
          nickname: session.nickname,
          activeTabId: initialTab
        }, msg.token);
      }

      if (msg.type === 'tab-switch' && clientInfo) {
        clientInfo.activeTabId = msg.tabId;
        const session = sessions.get(clientInfo.token);
        if (session) {
          broadcastToRoom(session.roomId, {
            type: 'tab-switch',
            nickname: clientInfo.nickname,
            tabId: msg.tabId
          }, clientInfo.token);
        }
      }

      if (msg.type === 'note-editing' && clientInfo) {
        const session = sessions.get(clientInfo.token);
        if (!session) return;
        const lockKey = `${session.roomId}:${msg.tabId}:${msg.noteId}`;
        const existing = editLocks.get(lockKey);
        if (existing && existing.token !== clientInfo.token) {
          // Release stale locks
          if (Date.now() - existing.lockedAt > LIMITS.EDIT_LOCK_TTL) {
            editLocks.delete(lockKey);
            broadcastToRoom(session.roomId, {
              type: 'note-edit-done',
              tabId: msg.tabId,
              noteId: msg.noteId,
              nickname: existing.nickname
            }, clientInfo.token);
          } else {
            ws.send(JSON.stringify({
              type: 'note-lock-denied',
              tabId: msg.tabId,
              noteId: msg.noteId,
              lockedBy: existing.nickname
            }));
            return;
          }
        }
        editLocks.set(lockKey, { nickname: clientInfo.nickname, token: clientInfo.token, lockedAt: Date.now() });
        // Maintain secondary index
        if (!roomLockKeys.has(session.roomId)) roomLockKeys.set(session.roomId, new Set());
        roomLockKeys.get(session.roomId).add(lockKey);
        broadcastToRoom(session.roomId, {
          type: 'note-editing',
          tabId: msg.tabId,
          noteId: msg.noteId,
          nickname: clientInfo.nickname
        }, clientInfo.token);
      }

      if (msg.type === 'note-edit-done' && clientInfo) {
        const session = sessions.get(clientInfo.token);
        if (!session) return;
        const lockKey = `${session.roomId}:${msg.tabId}:${msg.noteId}`;
        const existing = editLocks.get(lockKey);
        if (existing && existing.token === clientInfo.token) {
          editLocks.delete(lockKey);
          // Maintain secondary index
          roomLockKeys.get(session.roomId)?.delete(lockKey);
          broadcastToRoom(session.roomId, {
            type: 'note-edit-done',
            tabId: msg.tabId,
            noteId: msg.noteId,
            nickname: clientInfo.nickname
          }, clientInfo.token);
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
        // Persist alert atomically
        storage.atomicUpdateAlerts(session.roomId, (alerts) => {
          alerts.push(alert);
          // Cap alerts — mutate in place since atomic helper writes the original array ref
          while (alerts.length > LIMITS.MAX_ALERTS) alerts.shift();
          return true;
        }).catch(err => console.error('[finding-flagged] save error:', err));
        // Broadcast to other clients (include the alert object)
        broadcastToRoom(session.roomId, {
          type: 'finding-flagged',
          ...alert
        }, clientInfo.token);
      }
    } catch (err) {
      console.error('[sync-ws] message error:', err.message);
    }
  });

  ws.on('close', () => {
    if (!clientInfo) return;
    const session = sessions.get(clientInfo.token);
    if (!session) return;

    const roomId = session.roomId;

    // Release all edit locks held by this client
    for (const [key, lock] of editLocks) {
      if (lock.token === clientInfo.token) {
        editLocks.delete(key);
        // Maintain secondary index
        roomLockKeys.get(roomId)?.delete(key);
        const parts = key.split(':');
        const tabId = parts[1];
        const noteId = parts.slice(2).join(':');
        broadcastToRoom(roomId, {
          type: 'note-edit-done',
          tabId,
          noteId,
          nickname: clientInfo.nickname
        }, clientInfo.token);
      }
    }

    const clients = roomClients.get(roomId);
    if (clients) {
      clients.delete(clientInfo);
      if (clients.size === 0) {
        roomClients.delete(roomId);
      }
    }

    broadcastToRoom(roomId, {
      type: 'user-left',
      nickname: clientInfo.nickname
    }, clientInfo.token);
  });
});

// Sync WebSocket heartbeat
const syncHeartbeat = setInterval(() => {
  for (const client of syncWss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, LIMITS.WS_PING_INTERVAL);

syncWss.on('close', () => clearInterval(syncHeartbeat));

// --- Bootstrap ---
async function bootstrap() {
  await fsp.mkdir(storage.ROOMS_DIR, { recursive: true });
  try {
    await fsp.access(storage.ROOMS_FILE);
  } catch {
    await fsp.writeFile(storage.ROOMS_FILE, JSON.stringify({ rooms: [] }, null, 2));
  }
  await fsp.mkdir(PLAYBOOKS_DIR, { recursive: true });
}

// --- Start server ---
bootstrap().then(() => {
  server.listen(PORT, () => {
    const proto = server instanceof https.Server ? 'https' : 'http';
    console.log(`Riptide running at ${proto}://localhost:${PORT}`);
    if (proto === 'https') {
      console.log(`  SSL key:  ${SSL_KEY}`);
      console.log(`  SSL cert: ${SSL_CERT}`);
      console.log('  Set NO_SSL=1 to disable HTTPS');
    }
  });
}).catch(err => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});

function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  // Kill all PTY processes
  for (const entry of ptyProcesses.values()) {
    try { entry.pty.kill(); } catch { /* ignore */ }
  }
  ptyProcesses.clear();
  roomPtyKeys.clear();

  // Clear all other indexes
  editLocks.clear();
  roomLockKeys.clear();
  sessions.clear();
  roomSessionTokens.clear();

  // Close WebSocket servers
  try { wss.close(); } catch { /* ignore */ }
  try { syncWss.close(); } catch { /* ignore */ }

  // Close individual WebSocket connections
  for (const clients of roomClients.values()) {
    for (const client of clients) {
      try { client.ws.close(); } catch { /* ignore */ }
    }
  }

  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});
