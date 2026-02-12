'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// --- Tunable limits (storage-relevant subset) ---
const MAX_FILENAME_LENGTH = 200;

// --- Async write lock (prevents concurrent file write corruption) ---
const writeLocks = new Map();
async function withWriteLock(key, fn) {
  const prev = writeLocks.get(key) || Promise.resolve();
  let resolve;
  const current = new Promise(r => { resolve = r; });
  writeLocks.set(key, current);
  try {
    await Promise.race([
      prev,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Write lock timeout exceeded')), 30000))
    ]);
    return await fn();
  } finally {
    resolve();
    if (writeLocks.get(key) === current) {
      writeLocks.delete(key);
    }
  }
}

// --- Generic atomic update helper ---
async function atomicUpdateJsonFile(filePath, defaultValue, updateFn, { preFn, postFn, writeOptions } = {}) {
  return withWriteLock(filePath, async () => {
    if (preFn) await preFn();
    let data;
    try {
      data = JSON.parse(await fsp.readFile(filePath, 'utf-8'));
    } catch {
      // Deep clone default to avoid shared references
      data = typeof defaultValue === 'function'
        ? defaultValue()
        : JSON.parse(JSON.stringify(defaultValue));
    }
    const result = await updateFn(data);
    if (result === false) return result; // Skip write if updateFn signals no-op
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), writeOptions);
    if (postFn) await postFn();
    return result;
  });
}

// --- Room data directory ---
let ROOMS_DIR = path.join(__dirname, '..', 'rooms');
let ROOMS_FILE = path.join(ROOMS_DIR, 'rooms.json');

// --- WorkDir cache: roomId -> workDir path or null ---
const roomWorkDirCache = new Map();

// --- Tabs cache: roomId -> { data, expiry } ---
const roomTabsCache = new Map();
const TABS_CACHE_TTL = 15000; // 15 seconds — writes invalidate explicitly

// --- Rooms cache: { data, expiry } ---
let roomsCache = null;
const ROOMS_CACHE_TTL = 5000; // 5 seconds — writes invalidate explicitly

// --- Credential export helpers ---
function formatCredentialExport(creds) {
  const userCreds = [];
  for (const e of creds) {
    if (e.username && e.password) userCreds.push(`${e.username}:${e.password}`);
    if (e.username && e.hash) userCreds.push(`${e.username}:${e.hash}`);
  }

  const usernames = [...new Set(creds.filter(e => e.username).map(e => e.username))];

  const secrets = [...new Set([
    ...creds.filter(e => e.password).map(e => e.password),
    ...creds.filter(e => e.hash).map(e => e.hash)
  ])];

  return { userCreds, usernames, secrets };
}

async function writeCredentialFiles(dir, prefix, creds) {
  const { userCreds, usernames, secrets } = formatCredentialExport(creds);
  const written = [];

  if (userCreds.length) {
    const filename = prefix ? `${prefix}_credentials.txt` : 'credentials.txt';
    const fp = path.join(dir, filename);
    await fsp.writeFile(fp, userCreds.join('\n') + '\n', { mode: 0o600 });
    written.push(fp);
  }

  if (usernames.length) {
    const filename = prefix ? `${prefix}_usernames.txt` : 'usernames.txt';
    const fp = path.join(dir, filename);
    await fsp.writeFile(fp, usernames.join('\n') + '\n', { mode: 0o600 });
    written.push(fp);
  }

  if (secrets.length) {
    const filename = prefix ? `${prefix}_passwords_hashes.txt` : 'passwords_hashes.txt';
    const fp = path.join(dir, filename);
    await fsp.writeFile(fp, secrets.join('\n') + '\n', { mode: 0o600 });
    written.push(fp);
  }

  return written;
}

// --- Filesystem helpers ---
function sanitizeForFilesystem(name) {
  let safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.+$/, '').trim() || 'unnamed';
  // Block Windows reserved device names
  const reserved = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)/i;
  if (reserved.test(safe)) safe = '_' + safe;
  // Strip leading dots (hidden files on Unix)
  safe = safe.replace(/^\.+/, '');
  // Limit filename length
  if (safe.length > MAX_FILENAME_LENGTH) safe = safe.substring(0, MAX_FILENAME_LENGTH);
  return safe || 'unnamed';
}

async function fileExists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

function getRoomDir(roomId) {
  return path.join(ROOMS_DIR, roomId);
}

// --- Room storage ---
async function readRooms() {
  if (roomsCache && Date.now() < roomsCache.expiry) {
    return roomsCache.data;
  }
  try {
    const data = JSON.parse(await fsp.readFile(ROOMS_FILE, 'utf-8'));
    roomsCache = { data, expiry: Date.now() + ROOMS_CACHE_TTL };
    return data;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('readRooms error:', err.message);
    return { rooms: [] };
  }
}

async function atomicUpdateRooms(updateFn) {
  return atomicUpdateJsonFile(ROOMS_FILE, { rooms: [] }, updateFn, {
    postFn: () => { roomWorkDirCache.clear(); roomsCache = null; }
  });
}

// --- WorkDir resolution ---
async function getWorkDir(roomId) {
  if (roomWorkDirCache.has(roomId)) return roomWorkDirCache.get(roomId);
  const data = await readRooms();
  const room = data.rooms.find(r => r.id === roomId);
  const wd = (room && room.workDir) || null;
  roomWorkDirCache.set(roomId, wd);
  return wd;
}

async function resolveRoomDataDir(roomId) {
  const wd = await getWorkDir(roomId);
  return wd || getRoomDir(roomId);
}

async function resolveTabDataDir(roomId, tabId) {
  const wd = await getWorkDir(roomId);
  if (!wd) return path.join(ROOMS_DIR, roomId, 'notes', tabId);
  const tabsData = await readRoomTabs(roomId);
  const tab = tabsData && tabsData.tabs.find(t => t.id === tabId);
  const tabName = tab ? sanitizeForFilesystem(tab.name) : tabId;
  return path.join(wd, tabName);
}

// --- Tab storage ---
async function readRoomTabs(roomId) {
  const cached = roomTabsCache.get(roomId);
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }
  try {
    // Try workDir first (check cache / rooms.json), fall back to room dir
    const wd = await getWorkDir(roomId);
    const filePath = wd
      ? path.join(wd, 'tabs.json')
      : path.join(getRoomDir(roomId), 'tabs.json');
    const data = JSON.parse(await fsp.readFile(filePath, 'utf-8'));
    roomTabsCache.set(roomId, { data, expiry: Date.now() + TABS_CACHE_TTL });
    return data;
  } catch (err) {
    if (err.code !== 'ENOENT' && err.name !== 'SyntaxError') console.error('readRoomTabs error:', err.message);
    return null;
  }
}

async function writeRoomTabs(roomId, data) {
  const wd = await getWorkDir(roomId);
  const dir = wd || getRoomDir(roomId);
  const filePath = path.join(dir, 'tabs.json');
  return withWriteLock(filePath, async () => {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2));
    roomTabsCache.delete(roomId);
  });
}

async function atomicUpdateRoomTabs(roomId, updateFn) {
  const wd = await getWorkDir(roomId);
  const dir = wd || getRoomDir(roomId);
  const filePath = path.join(dir, 'tabs.json');
  return atomicUpdateJsonFile(filePath, { tabs: [], activeTabId: null }, updateFn, {
    preFn: async () => { await fsp.mkdir(dir, { recursive: true }); },
    postFn: () => { roomTabsCache.delete(roomId); }
  });
}

// --- Note storage ---
async function ensureTabDataDir(roomId, tabId) {
  const dir = await resolveTabDataDir(roomId, tabId);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function getNotesOrder(roomId, tabId) {
  try {
    const dir = await resolveTabDataDir(roomId, tabId);
    const orderFile = path.join(dir, '_order.json');
    return JSON.parse(await fsp.readFile(orderFile, 'utf-8'));
  } catch (err) {
    if (err.code !== 'ENOENT' && err.name !== 'SyntaxError') console.error('getNotesOrder error:', err.message);
    return null;
  }
}

async function saveNotesOrder(roomId, tabId, order) {
  const dir = await ensureTabDataDir(roomId, tabId);
  const orderFile = path.join(dir, '_order.json');
  return withWriteLock(orderFile, async () => {
    await fsp.writeFile(orderFile, JSON.stringify(order));
  });
}

// --- Scratch notes storage ---
async function readScratchNotes(roomId, tabId) {
  // If tabId is null/undefined, read global notes
  // With workDir: {workDir}/global-notes.json or {workDir}/{TabName}/scratch-notes.json
  // Without: rooms/{roomId}/global-notes.json or rooms/{roomId}/notes/{tabId}/scratch-notes.json
  try {
    let filePath;
    if (tabId) {
      const dir = await resolveTabDataDir(roomId, tabId);
      filePath = path.join(dir, 'scratch-notes.json');
    } else {
      const baseDir = await resolveRoomDataDir(roomId);
      filePath = path.join(baseDir, 'global-notes.json');
    }
    return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
  } catch (err) {
    if (err.code !== 'ENOENT' && err.name !== 'SyntaxError') console.error('readScratchNotes error:', err.message);
    return [];
  }
}

async function atomicUpdateScratchNotes(roomId, tabId, updateFn) {
  let filePath;
  if (tabId) {
    const dir = await resolveTabDataDir(roomId, tabId);
    filePath = path.join(dir, 'scratch-notes.json');
  } else {
    const baseDir = await resolveRoomDataDir(roomId);
    filePath = path.join(baseDir, 'global-notes.json');
  }
  return atomicUpdateJsonFile(filePath, [], updateFn, {
    preFn: async () => { await fsp.mkdir(path.dirname(filePath), { recursive: true }); }
  });
}

// --- Chat storage ---
async function readChat(roomId, tabId) {
  try {
    let filePath;
    if (tabId) {
      const dir = await resolveTabDataDir(roomId, tabId);
      filePath = path.join(dir, 'chat.json');
    } else {
      const baseDir = await resolveRoomDataDir(roomId);
      filePath = path.join(baseDir, 'global-chat.json');
    }
    return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
  } catch (err) {
    if (err.code !== 'ENOENT' && err.name !== 'SyntaxError') console.error('readChat error:', err.message);
    return [];
  }
}

async function atomicUpdateChat(roomId, tabId, updateFn) {
  let filePath;
  if (tabId) {
    const dir = await resolveTabDataDir(roomId, tabId);
    filePath = path.join(dir, 'chat.json');
  } else {
    const baseDir = await resolveRoomDataDir(roomId);
    filePath = path.join(baseDir, 'global-chat.json');
  }
  return atomicUpdateJsonFile(filePath, [], updateFn, {
    preFn: async () => { await fsp.mkdir(path.dirname(filePath), { recursive: true }); }
  });
}

// --- Credentials storage ---
async function getCredentialsPath(roomId, tabId) {
  const dir = await resolveTabDataDir(roomId, tabId);
  return path.join(dir, 'credentials.json');
}

async function readCredentials(roomId, tabId) {
  try {
    return JSON.parse(await fsp.readFile(await getCredentialsPath(roomId, tabId), 'utf-8'));
  } catch (err) {
    if (err.code !== 'ENOENT' && err.name !== 'SyntaxError') console.error('readCredentials error:', err.message);
    return [];
  }
}

async function atomicUpdateCredentials(roomId, tabId, updateFn) {
  const filePath = await getCredentialsPath(roomId, tabId);
  return atomicUpdateJsonFile(filePath, [], updateFn, {
    preFn: async () => { await ensureTabDataDir(roomId, tabId); },
    writeOptions: { mode: 0o600 }
  });
}

async function getGlobalCredentialsPath(roomId) {
  const dir = await resolveRoomDataDir(roomId);
  return path.join(dir, 'credentials.json');
}

async function readGlobalCredentials(roomId) {
  try {
    return JSON.parse(await fsp.readFile(await getGlobalCredentialsPath(roomId), 'utf-8'));
  } catch (err) {
    if (err.code !== 'ENOENT' && err.name !== 'SyntaxError') console.error('readGlobalCredentials error:', err.message);
    return [];
  }
}

async function atomicUpdateGlobalCredentials(roomId, updateFn) {
  const dir = await resolveRoomDataDir(roomId);
  const filePath = await getGlobalCredentialsPath(roomId);
  return atomicUpdateJsonFile(filePath, [], updateFn, {
    preFn: async () => { await fsp.mkdir(dir, { recursive: true }); },
    writeOptions: { mode: 0o600 }
  });
}

// --- Global variables storage ---
async function readGlobalVariables(roomId) {
  try {
    const dir = await resolveRoomDataDir(roomId);
    return JSON.parse(await fsp.readFile(path.join(dir, 'global-variables.json'), 'utf-8'));
  } catch (err) {
    if (err.code !== 'ENOENT' && err.name !== 'SyntaxError') console.error('readGlobalVariables error:', err.message);
    return {};
  }
}

async function atomicUpdateGlobalVariables(roomId, updateFn) {
  const dir = await resolveRoomDataDir(roomId);
  const filePath = path.join(dir, 'global-variables.json');
  return atomicUpdateJsonFile(filePath, {}, updateFn, {
    preFn: async () => { await fsp.mkdir(dir, { recursive: true }); }
  });
}

// --- Recordings storage ---
async function resolveRecordingsDir(roomId, tabId) {
  return path.join(await resolveTabDataDir(roomId, tabId), 'recordings');
}

async function ensureRecordingsDir(roomId, tabId) {
  const dir = await resolveRecordingsDir(roomId, tabId);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function readRecordingsList(roomId, tabId) {
  try {
    const dir = await resolveRecordingsDir(roomId, tabId);
    const files = await fsp.readdir(dir);
    const recordings = [];
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = await fsp.stat(filePath);
      if (stats.isFile()) {
        recordings.push({
          name: file,
          size: stats.size,
          modified: stats.mtime.getTime()
        });
      }
    }
    // Sort by modified descending (newest first)
    recordings.sort((a, b) => b.modified - a.modified);
    return recordings;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('readRecordingsList error:', err.message);
    return [];
  }
}

// --- Alerts storage ---
async function readAlerts(roomId) {
  try {
    const dir = await resolveRoomDataDir(roomId);
    const filePath = path.join(dir, 'alerts.json');
    const raw = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.name !== 'SyntaxError') console.error('readAlerts error:', err.message);
    return [];
  }
}

async function writeAlerts(roomId, alerts) {
  const dir = await resolveRoomDataDir(roomId);
  await fsp.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'alerts.json');
  return withWriteLock(filePath, async () => {
    await fsp.writeFile(filePath, JSON.stringify(alerts, null, 2), { mode: 0o600 });
  });
}

async function atomicUpdateAlerts(roomId, updateFn) {
  const dir = await resolveRoomDataDir(roomId);
  const filePath = path.join(dir, 'alerts.json');
  return atomicUpdateJsonFile(filePath, [], updateFn, {
    preFn: async () => { await fsp.mkdir(dir, { recursive: true }); },
    writeOptions: { mode: 0o600 }
  });
}

// --- Room initialization ---
async function initRoom(roomId) {
  const roomDir = getRoomDir(roomId);
  await fsp.mkdir(roomDir, { recursive: true });

  const wd = await getWorkDir(roomId);
  if (wd) {
    // workDir mode: ensure workDir exists (tabs.json lives there)
    await fsp.mkdir(wd, { recursive: true });
  } else {
    // Legacy mode: notes subdir inside room dir
    await fsp.mkdir(path.join(roomDir, 'notes'), { recursive: true });
  }

  // Create initial tab if no tabs.json
  if (!await readRoomTabs(roomId)) {
    const tabId = crypto.randomBytes(8).toString('hex');
    const tabsData = {
      tabs: [{ id: tabId, name: 'Main', activeNoteId: null, variables: {}, commandHistory: [], status: null }],
      activeTabId: tabId
    };
    await writeRoomTabs(roomId, tabsData);
    await ensureTabDataDir(roomId, tabId);
  }
}

// --- Knowledge Base storage ---
let KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');
let KNOWLEDGE_FILE = path.join(KNOWLEDGE_DIR, 'knowledge.json');

async function readKnowledge() {
  try {
    const data = JSON.parse(await fsp.readFile(KNOWLEDGE_FILE, 'utf-8'));
    return data;
  } catch (err) {
    if (err.code !== 'ENOENT' && err.name !== 'SyntaxError') console.error('readKnowledge error:', err.message);
    return { entries: [], tags: {} };
  }
}

async function writeKnowledge(data) {
  return withWriteLock(KNOWLEDGE_FILE, async () => {
    await fsp.mkdir(KNOWLEDGE_DIR, { recursive: true });
    await fsp.writeFile(KNOWLEDGE_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  });
}

async function atomicUpdateKnowledge(updateFn) {
  return atomicUpdateJsonFile(KNOWLEDGE_FILE, { entries: [], tags: {} }, updateFn, {
    preFn: async () => { await fsp.mkdir(KNOWLEDGE_DIR, { recursive: true }); },
    writeOptions: { mode: 0o600 }
  });
}

/**
 * Override KNOWLEDGE_DIR and KNOWLEDGE_FILE for testing.
 * Returns a restore function that resets to original values.
 */
function _setTestKnowledgePaths(knowledgeDir, knowledgeFile) {
  const origDir = KNOWLEDGE_DIR;
  const origFile = KNOWLEDGE_FILE;
  KNOWLEDGE_DIR = knowledgeDir;
  KNOWLEDGE_FILE = knowledgeFile;
  return () => {
    KNOWLEDGE_DIR = origDir;
    KNOWLEDGE_FILE = origFile;
  };
}

/**
 * Override ROOMS_DIR and ROOMS_FILE for testing.
 * Returns a restore function that resets to original values.
 */
function _setTestPaths(roomsDir, roomsFile) {
  const origDir = ROOMS_DIR;
  const origFile = ROOMS_FILE;
  ROOMS_DIR = roomsDir;
  ROOMS_FILE = roomsFile;
  return () => {
    ROOMS_DIR = origDir;
    ROOMS_FILE = origFile;
  };
}

module.exports = {
  // Write lock
  withWriteLock,
  atomicUpdateJsonFile,

  // Constants (getters so they reflect current mutable values)
  get ROOMS_DIR() { return ROOMS_DIR; },
  get ROOMS_FILE() { return ROOMS_FILE; },
  get KNOWLEDGE_DIR() { return KNOWLEDGE_DIR; },
  get KNOWLEDGE_FILE() { return KNOWLEDGE_FILE; },

  // Caches
  roomWorkDirCache,
  roomTabsCache,
  TABS_CACHE_TTL,
  get roomsCache() { return roomsCache; },
  set roomsCache(v) { roomsCache = v; },
  ROOMS_CACHE_TTL,

  // Filesystem helpers
  sanitizeForFilesystem,
  fileExists,
  getRoomDir,

  // Room storage
  readRooms,
  atomicUpdateRooms,
  getWorkDir,
  resolveRoomDataDir,
  resolveTabDataDir,
  initRoom,

  // Tab storage
  readRoomTabs,
  writeRoomTabs,
  atomicUpdateRoomTabs,

  // Note storage
  ensureTabDataDir,
  getNotesOrder,
  saveNotesOrder,

  // Scratch notes
  readScratchNotes,
  atomicUpdateScratchNotes,

  // Chat
  readChat,
  atomicUpdateChat,

  // Credentials
  getCredentialsPath,
  readCredentials,
  atomicUpdateCredentials,
  getGlobalCredentialsPath,
  readGlobalCredentials,
  atomicUpdateGlobalCredentials,

  // Credential export
  formatCredentialExport,
  writeCredentialFiles,

  // Global variables
  readGlobalVariables,
  atomicUpdateGlobalVariables,

  // Alerts
  readAlerts,
  writeAlerts,
  atomicUpdateAlerts,

  // Recordings
  resolveRecordingsDir,
  ensureRecordingsDir,
  readRecordingsList,

  // Knowledge Base
  readKnowledge,
  writeKnowledge,
  atomicUpdateKnowledge,

  // Test helpers
  _setTestPaths,
  _setTestKnowledgePaths
};
