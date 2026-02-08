'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const helpers = require('../../lib/helpers');

/**
 * Create a fully isolated mock routeCtx for integration tests.
 *
 * - Creates a real temp directory with rooms/ and playbooks/ subdirs
 * - Patches storage module paths (ROOMS_DIR, ROOMS_FILE) to point at temp dir
 * - Provides real storage functions operating on the temp filesystem
 * - Mocks in-memory Maps (sessions, editLocks, roomClients, etc.)
 * - Records broadcastToRoom calls for assertion
 * - Provides addSession() helper for easy auth setup
 * - cleanup() removes temp dir and restores storage module
 *
 * Usage:
 *   const { createMockContext, cleanup } = require('./mock-context');
 *   let ctx;
 *   beforeAll(async () => { ctx = await createMockContext(); });
 *   afterAll(async () => { await cleanup(ctx); });
 */
async function createMockContext(opts = {}) {
  // Create isolated temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'riptide-test-'));
  const roomsDir = path.join(tempDir, 'rooms');
  const playbooksDir = path.join(tempDir, 'playbooks');

  await fsp.mkdir(roomsDir, { recursive: true });
  await fsp.mkdir(playbooksDir, { recursive: true });

  // Write initial rooms.json
  const roomsFile = path.join(roomsDir, 'rooms.json');
  await fsp.writeFile(roomsFile, JSON.stringify({ rooms: [] }, null, 2));

  // Seed a sample playbook
  await fsp.writeFile(path.join(playbooksDir, 'test-recon.md'), `---
tags: [recon, test]
---
# Test Recon Playbook

\`\`\`bash
nmap -sC -sV <TargetIP>
\`\`\`
`);

  // Patch storage module to use temp paths
  const storage = require('../../lib/storage');
  const restorePaths = storage._setTestPaths(roomsDir, roomsFile);

  // Clear caches to ensure clean state
  storage.roomWorkDirCache.clear();
  storage.roomTabsCache.clear();

  // In-memory state Maps (mirrors server.js)
  const sessions = new Map();
  const editLocks = new Map();
  const roomClients = new Map();
  const ptyProcesses = new Map();
  const roomPtyKeys = new Map();
  const roomLockKeys = new Map();
  const roomSessionTokens = new Map();

  // Broadcast recorder
  const broadcasts = [];
  function broadcastToRoom(roomId, event, excludeToken) {
    broadcasts.push({ roomId, event, excludeToken });
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

  // Limits (matching server.js defaults)
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
    MAX_WS_MESSAGE_BYTES: 65536
  };

  // Session management helper
  function createSession(roomId, nickname) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { roomId, nickname, connectedAt: Date.now() });
    if (!roomSessionTokens.has(roomId)) roomSessionTokens.set(roomId, new Set());
    roomSessionTokens.get(roomId).add(token);
    return token;
  }

  // Credential validation (wraps helpers with LIMITS)
  function validateCredentialFields(req, res, localOpts = {}) {
    return helpers.validateCredentialFields(req, res, {
      ...localOpts,
      maxFieldLength: LIMITS.MAX_CREDENTIAL_FIELD_LENGTH
    });
  }

  // Auth middleware — configurable per-test via ctx.setAuth()
  let authOverride = null;

  function requireRoom(req, res, next) {
    if (authOverride) {
      req.roomId = authOverride.roomId;
      req.nickname = authOverride.nickname;
      req.token = authOverride.token;
      return next();
    }
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const session = sessions.get(token);
    if (!session) {
      // Fallback: check for short-lived image token in query string
      if (req.query && req.query.token) {
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
    if (Date.now() - session.connectedAt > LIMITS.SESSION_TTL_MS) {
      sessions.delete(token);
      roomSessionTokens.get(session.roomId)?.delete(token);
      return res.status(401).json({ error: 'Session expired' });
    }
    req.roomId = session.roomId;
    req.nickname = session.nickname;
    req.token = token;
    next();
  }

  // Tab validation middleware (mirrors server.js validateTabId)
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

  // Note ID validation middleware (mirrors server.js validateNoteId)
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

  // Image token support (matches server.js HMAC-based implementation)
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

  // Stub rate limiter (pass-through)
  function authLimiter(_req, _res, next) { next(); }

  // Stub file upload (no-op for most tests)
  const fileUpload = {
    single: () => (_req, _res, next) => next(),
    array: () => (_req, _res, next) => next()
  };

  // Stub seedPlaybookLibrary (already seeded above)
  async function seedPlaybookLibrary() { /* no-op in tests */ }

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
    hashPassword: helpers.hashPassword,
    verifyPassword: helpers.verifyPassword,
    createSession,
    generateImageToken,
    validateImageToken,
    validateCredentialFields,
    requireRoom,
    validateTabId,
    validateNoteId,
    authLimiter,
    fileUpload,
    PLAYBOOKS_DIR: playbooksDir,
    parseFrontmatter: helpers.parseFrontmatter,
    seedPlaybookLibrary,
    ALLOWED_WORKDIR_BASE: opts.allowedWorkDirBase || null,
    AdmZip: require('adm-zip')
  };

  return {
    routeCtx,
    tempDir,
    roomsDir,
    roomsFile,
    playbooksDir,
    storage,
    broadcasts,
    sessions,
    editLocks,

    /** Add an authenticated session and return the token */
    addSession(roomId, nickname) {
      return createSession(roomId, nickname);
    },

    /** Override auth for all requests (set null to use real token auth) */
    setAuth(override) {
      authOverride = override;
    },

    /** Clear broadcast recordings */
    clearBroadcasts() {
      broadcasts.length = 0;
    },

    /** Restore originals — stored for cleanup */
    _restorePaths: restorePaths
  };
}

/**
 * Tear down: remove temp directory and restore storage module paths.
 */
async function cleanup(ctx) {
  if (!ctx) return;

  // Restore original storage paths
  const storage = ctx.storage;
  if (ctx._restorePaths) ctx._restorePaths();

  // Clear caches
  storage.roomWorkDirCache.clear();
  storage.roomTabsCache.clear();

  // Remove temp directory
  try {
    await fsp.rm(ctx.tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

module.exports = {
  createMockContext,
  cleanup
};
