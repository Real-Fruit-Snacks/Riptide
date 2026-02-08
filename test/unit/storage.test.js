'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const storage = require('../../lib/storage');
const {
  SAMPLE_CREDENTIALS,
  SAMPLE_TAB,
  SAMPLE_TAB_2,
  SAMPLE_SCRATCH_NOTES,
  SAMPLE_GLOBAL_VARIABLES
} = require('../helpers/fixtures');

// ---------------------------------------------------------------------------
// Shared temp directory for pure-function tests
// ---------------------------------------------------------------------------
let tempDir;

let restorePaths;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'riptide-storage-'));
  restorePaths = storage._setTestPaths(tempDir, path.join(tempDir, 'rooms.json'));
  fs.writeFileSync(path.join(tempDir, 'rooms.json'), JSON.stringify({ rooms: [] }));
});

afterAll(() => {
  restorePaths();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  storage.roomWorkDirCache.clear();
  storage.roomTabsCache.clear();
});

// ===========================================================================
//  withWriteLock
// ===========================================================================
describe('withWriteLock', () => {
  it('serializes concurrent calls on the same key', async () => {
    const order = [];
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    const p1 = storage.withWriteLock('key-a', async () => {
      order.push('p1-start');
      await delay(50);
      order.push('p1-end');
      return 1;
    });

    const p2 = storage.withWriteLock('key-a', async () => {
      order.push('p2-start');
      await delay(10);
      order.push('p2-end');
      return 2;
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    // p1 must complete before p2 starts
    expect(order).toEqual(['p1-start', 'p1-end', 'p2-start', 'p2-end']);
  });

  it('allows parallel calls on different keys', async () => {
    const order = [];
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    const p1 = storage.withWriteLock('key-x', async () => {
      order.push('x-start');
      await delay(50);
      order.push('x-end');
    });

    const p2 = storage.withWriteLock('key-y', async () => {
      order.push('y-start');
      await delay(50);
      order.push('y-end');
    });

    await Promise.all([p1, p2]);
    // Both should start before either ends (parallel execution)
    const xStart = order.indexOf('x-start');
    const yStart = order.indexOf('y-start');
    const xEnd = order.indexOf('x-end');
    const yEnd = order.indexOf('y-end');
    expect(xStart).toBeLessThan(xEnd);
    expect(yStart).toBeLessThan(yEnd);
    // Both start before any end — true parallelism
    expect(Math.max(xStart, yStart)).toBeLessThan(Math.min(xEnd, yEnd));
  });

  it('returns the value from the function', async () => {
    const result = await storage.withWriteLock('ret-test', async () => 42);
    expect(result).toBe(42);
  });

  it('propagates errors and releases the lock', async () => {
    await expect(
      storage.withWriteLock('err-key', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    // Lock should be released — next call must succeed
    const result = await storage.withWriteLock('err-key', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('cleans up lock entry after completion', async () => {
    await storage.withWriteLock('cleanup-key', async () => {});
    // Internal writeLocks Map is not exported, but we can verify that
    // a subsequent call starts immediately (no stale promise blocking)
    const start = Date.now();
    await storage.withWriteLock('cleanup-key', async () => {});
    expect(Date.now() - start).toBeLessThan(100);
  });
});

// ===========================================================================
//  atomicUpdateJsonFile
// ===========================================================================
describe('atomicUpdateJsonFile', () => {
  it('creates file with defaultValue when not existing', async () => {
    const fp = path.join(tempDir, 'new-file.json');
    await storage.atomicUpdateJsonFile(fp, { items: [] }, (data) => {
      data.items.push('first');
    });
    const written = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    expect(written.items).toEqual(['first']);
  });

  it('reads and updates an existing file', async () => {
    const fp = path.join(tempDir, 'existing.json');
    fs.writeFileSync(fp, JSON.stringify({ count: 5 }));

    await storage.atomicUpdateJsonFile(fp, { count: 0 }, (data) => {
      data.count += 1;
    });
    const written = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    expect(written.count).toBe(6);
  });

  it('supports defaultValue as a function', async () => {
    const fp = path.join(tempDir, 'fn-default.json');
    await storage.atomicUpdateJsonFile(fp, () => ({ items: ['init'] }), (data) => {
      data.items.push('second');
    });
    const written = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    expect(written.items).toEqual(['init', 'second']);
  });

  it('skips write when updateFn returns false', async () => {
    const fp = path.join(tempDir, 'skip-write.json');
    fs.writeFileSync(fp, JSON.stringify({ val: 'original' }));

    const result = await storage.atomicUpdateJsonFile(fp, {}, (_data) => {
      // Signal no-op
      return false;
    });
    expect(result).toBe(false);
    const written = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    expect(written.val).toBe('original');
  });

  it('uses default when file contains corrupt JSON', async () => {
    const fp = path.join(tempDir, 'corrupt.json');
    fs.writeFileSync(fp, '{ broken json !!!');

    await storage.atomicUpdateJsonFile(fp, { items: [] }, (data) => {
      data.items.push('recovered');
    });
    const written = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    expect(written.items).toEqual(['recovered']);
  });

  it('calls preFn before read and postFn after write', async () => {
    const fp = path.join(tempDir, 'hooks.json');
    const callOrder = [];

    await storage.atomicUpdateJsonFile(fp, {}, (data) => {
      callOrder.push('update');
      data.x = 1;
    }, {
      preFn: async () => { callOrder.push('pre'); },
      postFn: async () => { callOrder.push('post'); }
    });

    expect(callOrder).toEqual(['pre', 'update', 'post']);
    expect(JSON.parse(fs.readFileSync(fp, 'utf-8'))).toEqual({ x: 1 });
  });

  it('does not call postFn when updateFn returns false', async () => {
    const fp = path.join(tempDir, 'no-post.json');
    fs.writeFileSync(fp, JSON.stringify({}));
    let postCalled = false;

    await storage.atomicUpdateJsonFile(fp, {}, () => false, {
      postFn: async () => { postCalled = true; }
    });

    expect(postCalled).toBe(false);
  });

  it('deep-clones object defaultValue to avoid shared references', async () => {
    const fp1 = path.join(tempDir, 'clone1.json');
    const fp2 = path.join(tempDir, 'clone2.json');
    const defaultVal = { list: [] };

    await storage.atomicUpdateJsonFile(fp1, defaultVal, (data) => {
      data.list.push('a');
    });
    await storage.atomicUpdateJsonFile(fp2, defaultVal, (data) => {
      data.list.push('b');
    });

    const d1 = JSON.parse(fs.readFileSync(fp1, 'utf-8'));
    const d2 = JSON.parse(fs.readFileSync(fp2, 'utf-8'));
    expect(d1.list).toEqual(['a']);
    expect(d2.list).toEqual(['b']);
  });

  it('serializes concurrent updates to the same file', async () => {
    const fp = path.join(tempDir, 'concurrent.json');
    fs.writeFileSync(fp, JSON.stringify({ count: 0 }));

    // Launch 10 concurrent increments
    const promises = Array.from({ length: 10 }, () =>
      storage.atomicUpdateJsonFile(fp, { count: 0 }, (data) => {
        data.count += 1;
      })
    );
    await Promise.all(promises);

    const written = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    expect(written.count).toBe(10);
  });
});

// ===========================================================================
//  sanitizeForFilesystem
// ===========================================================================
describe('sanitizeForFilesystem', () => {
  it('passes through clean names', () => {
    expect(storage.sanitizeForFilesystem('MyTarget')).toBe('MyTarget');
  });

  it('replaces null bytes and control characters', () => {
    expect(storage.sanitizeForFilesystem('a\x00b\x01c')).toBe('a_b_c');
  });

  it('replaces path separators', () => {
    expect(storage.sanitizeForFilesystem('a/b\\c')).toBe('a_b_c');
  });

  it('replaces illegal characters with underscores', () => {
    const illegal = '<>:"|?*';
    for (const ch of illegal) {
      const result = storage.sanitizeForFilesystem(`test${ch}name`);
      expect(result).not.toContain(ch);
      expect(result).toContain('_');
    }
  });

  it('blocks Windows reserved names by prefixing underscore', () => {
    const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT3'];
    for (const name of reserved) {
      expect(storage.sanitizeForFilesystem(name)).toBe(`_${name}`);
    }
  });

  it('blocks reserved names case-insensitively', () => {
    expect(storage.sanitizeForFilesystem('con')).toBe('_con');
    expect(storage.sanitizeForFilesystem('Con')).toBe('_Con');
  });

  it('blocks reserved names with extensions', () => {
    // "CON.txt" should match the reserved pattern CON followed by "."
    const result = storage.sanitizeForFilesystem('CON.txt');
    expect(result.startsWith('_')).toBe(true);
  });

  it('removes leading dots (hidden files on Unix)', () => {
    expect(storage.sanitizeForFilesystem('.hidden')).toBe('hidden');
    expect(storage.sanitizeForFilesystem('...multiple')).toBe('multiple');
  });

  it('removes trailing dots', () => {
    expect(storage.sanitizeForFilesystem('name...')).toBe('name');
  });

  it('truncates to 200 characters', () => {
    const long = 'a'.repeat(250);
    expect(storage.sanitizeForFilesystem(long).length).toBe(200);
  });

  it('returns "unnamed" for empty input', () => {
    expect(storage.sanitizeForFilesystem('')).toBe('unnamed');
  });

  it('returns "unnamed" for input that becomes empty after sanitization', () => {
    // All illegal chars → all replaced by underscores, but trailing dots removed
    // Actually: "..." → trailing dots removed → "" → 'unnamed'
    expect(storage.sanitizeForFilesystem('...')).toBe('unnamed');
  });

  it('handles whitespace-only input', () => {
    expect(storage.sanitizeForFilesystem('   ')).toBe('unnamed');
  });

  it('preserves hyphens, underscores, and spaces', () => {
    expect(storage.sanitizeForFilesystem('my-target_01 test')).toBe('my-target_01 test');
  });
});

// ===========================================================================
//  fileExists
// ===========================================================================
describe('fileExists', () => {
  it('returns true for an existing file', async () => {
    const fp = path.join(tempDir, 'exists.txt');
    fs.writeFileSync(fp, 'data');
    expect(await storage.fileExists(fp)).toBe(true);
  });

  it('returns false for a missing file', async () => {
    expect(await storage.fileExists(path.join(tempDir, 'nope.txt'))).toBe(false);
  });

  it('returns true for an existing directory', async () => {
    expect(await storage.fileExists(tempDir)).toBe(true);
  });
});

// ===========================================================================
//  formatCredentialExport
// ===========================================================================
describe('formatCredentialExport', () => {
  it('groups credentials into userCreds, usernames, secrets', () => {
    const result = storage.formatCredentialExport(SAMPLE_CREDENTIALS);

    // admin:P@ssw0rd!  and root:5f4dcc... and backup:backup123
    expect(result.userCreds).toContain('admin:P@ssw0rd!');
    expect(result.userCreds).toContain('root:5f4dcc3b5aa765d61d8327deb882cf99');
    expect(result.userCreds).toContain('backup:backup123');

    expect(result.usernames).toContain('admin');
    expect(result.usernames).toContain('root');
    expect(result.usernames).toContain('backup');

    expect(result.secrets).toContain('P@ssw0rd!');
    expect(result.secrets).toContain('5f4dcc3b5aa765d61d8327deb882cf99');
    expect(result.secrets).toContain('backup123');
  });

  it('handles credential with both password and hash', () => {
    const creds = [{ username: 'u1', password: 'pass', hash: 'abc123' }];
    const result = storage.formatCredentialExport(creds);
    expect(result.userCreds).toEqual(['u1:pass', 'u1:abc123']);
    expect(result.usernames).toEqual(['u1']);
    expect(result.secrets).toEqual(['pass', 'abc123']);
  });

  it('handles credentials with only username', () => {
    const creds = [{ username: 'lonely', password: '', hash: '' }];
    const result = storage.formatCredentialExport(creds);
    expect(result.userCreds).toEqual([]);
    expect(result.usernames).toEqual(['lonely']);
    expect(result.secrets).toEqual([]);
  });

  it('handles credentials with only hash (no username)', () => {
    const creds = [{ username: '', password: '', hash: 'deadbeef' }];
    const result = storage.formatCredentialExport(creds);
    expect(result.userCreds).toEqual([]);
    expect(result.usernames).toEqual([]);
    expect(result.secrets).toEqual(['deadbeef']);
  });

  it('deduplicates usernames and secrets', () => {
    const creds = [
      { username: 'admin', password: 'pass1', hash: '' },
      { username: 'admin', password: 'pass1', hash: '' }
    ];
    const result = storage.formatCredentialExport(creds);
    expect(result.usernames).toEqual(['admin']);
    expect(result.secrets).toEqual(['pass1']);
  });

  it('returns empty arrays for empty input', () => {
    const result = storage.formatCredentialExport([]);
    expect(result.userCreds).toEqual([]);
    expect(result.usernames).toEqual([]);
    expect(result.secrets).toEqual([]);
  });
});

// ===========================================================================
//  writeCredentialFiles
// ===========================================================================
describe('writeCredentialFiles', () => {
  let credDir;

  beforeEach(() => {
    credDir = path.join(tempDir, `creds-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(credDir, { recursive: true });
  });

  it('writes credentials.txt, usernames.txt, passwords_hashes.txt', async () => {
    const written = await storage.writeCredentialFiles(credDir, '', SAMPLE_CREDENTIALS);
    expect(written.length).toBe(3);

    const credsTxt = fs.readFileSync(path.join(credDir, 'credentials.txt'), 'utf-8');
    expect(credsTxt).toContain('admin:P@ssw0rd!');
    expect(credsTxt).toContain('backup:backup123');

    const usersTxt = fs.readFileSync(path.join(credDir, 'usernames.txt'), 'utf-8');
    expect(usersTxt).toContain('admin');
    expect(usersTxt).toContain('root');

    const secretsTxt = fs.readFileSync(path.join(credDir, 'passwords_hashes.txt'), 'utf-8');
    expect(secretsTxt).toContain('P@ssw0rd!');
    expect(secretsTxt).toContain('5f4dcc3b5aa765d61d8327deb882cf99');
  });

  it('uses prefix in filenames when provided', async () => {
    const written = await storage.writeCredentialFiles(credDir, 'Target1', SAMPLE_CREDENTIALS);
    expect(written.length).toBe(3);

    expect(fs.existsSync(path.join(credDir, 'Target1_credentials.txt'))).toBe(true);
    expect(fs.existsSync(path.join(credDir, 'Target1_usernames.txt'))).toBe(true);
    expect(fs.existsSync(path.join(credDir, 'Target1_passwords_hashes.txt'))).toBe(true);
  });

  it('returns empty array when no credentials to write', async () => {
    const written = await storage.writeCredentialFiles(credDir, '', []);
    expect(written).toEqual([]);
  });

  it('only writes files for non-empty categories', async () => {
    // Credential with only a username — no passwords or hashes
    const creds = [{ username: 'solo', password: '', hash: '' }];
    const written = await storage.writeCredentialFiles(credDir, '', creds);
    // Only usernames.txt should be written
    expect(written.length).toBe(1);
    expect(written[0]).toContain('usernames.txt');
  });

  it('sets restrictive file permissions (0o600)', async () => {
    await storage.writeCredentialFiles(credDir, '', SAMPLE_CREDENTIALS);
    const stat = fs.statSync(path.join(credDir, 'credentials.txt'));
    // Check owner read+write bits (0o600 = 384 decimal; mode & 0o777)
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('ends each file with a newline', async () => {
    await storage.writeCredentialFiles(credDir, '', SAMPLE_CREDENTIALS);
    const content = fs.readFileSync(path.join(credDir, 'credentials.txt'), 'utf-8');
    expect(content.endsWith('\n')).toBe(true);
  });
});

// ===========================================================================
//  getRoomDir
// ===========================================================================
describe('getRoomDir', () => {
  it('returns path under ROOMS_DIR', () => {
    const dir = storage.getRoomDir('abc123');
    expect(dir).toBe(path.join(storage.ROOMS_DIR, 'abc123'));
  });
});

// ===========================================================================
//  Room-dependent operations (using real rooms dir with workDir -> tempDir)
// ===========================================================================
describe('room operations', () => {
  // Unique test room IDs to avoid collisions with real data
  const TEST_ROOM_ID = `__test_room_${crypto.randomBytes(6).toString('hex')}`;
  const TEST_ROOM_NO_WD = `__test_room_nowd_${crypto.randomBytes(6).toString('hex')}`;
  let roomWorkDir;

  beforeAll(async () => {
    // Create a workDir in temp for the test room
    roomWorkDir = path.join(tempDir, 'workdir');
    fs.mkdirSync(roomWorkDir, { recursive: true });

    // Ensure rooms dir exists (now points to tempDir via _setTestPaths)
    fs.mkdirSync(storage.ROOMS_DIR, { recursive: true });

    // Add test rooms to rooms.json (already seeded with empty { rooms: [] })
    const data = JSON.parse(fs.readFileSync(storage.ROOMS_FILE, 'utf-8'));
    data.rooms.push(
      { id: TEST_ROOM_ID, name: 'Test Room', passwordHash: null, workDir: roomWorkDir },
      { id: TEST_ROOM_NO_WD, name: 'No WorkDir Room', passwordHash: null, workDir: null }
    );
    fs.writeFileSync(storage.ROOMS_FILE, JSON.stringify(data, null, 2));
  });

  beforeEach(() => {
    storage.roomWorkDirCache.clear();
    storage.roomTabsCache.clear();
  });

  // ---- readRooms / atomicUpdateRooms ----
  describe('readRooms', () => {
    it('reads rooms from rooms.json', async () => {
      const data = await storage.readRooms();
      expect(data.rooms).toBeDefined();
      expect(Array.isArray(data.rooms)).toBe(true);
      const testRoom = data.rooms.find((r) => r.id === TEST_ROOM_ID);
      expect(testRoom).toBeDefined();
      expect(testRoom.name).toBe('Test Room');
    });
  });

  describe('atomicUpdateRooms', () => {
    it('atomically updates rooms.json and clears workDir cache', async () => {
      // Pre-populate cache
      storage.roomWorkDirCache.set('some-room', '/cached');

      await storage.atomicUpdateRooms((data) => {
        const room = data.rooms.find((r) => r.id === TEST_ROOM_ID);
        if (room) room.name = 'Updated Test Room';
      });

      // Cache should be cleared by postFn
      expect(storage.roomWorkDirCache.size).toBe(0);

      // Verify file was updated
      const data = await storage.readRooms();
      const room = data.rooms.find((r) => r.id === TEST_ROOM_ID);
      expect(room.name).toBe('Updated Test Room');

      // Restore original name
      await storage.atomicUpdateRooms((data) => {
        const r = data.rooms.find((rm) => rm.id === TEST_ROOM_ID);
        if (r) r.name = 'Test Room';
      });
    });
  });

  // ---- getWorkDir ----
  describe('getWorkDir', () => {
    it('returns workDir for room with workDir set', async () => {
      const wd = await storage.getWorkDir(TEST_ROOM_ID);
      expect(wd).toBe(roomWorkDir);
    });

    it('returns null for room without workDir', async () => {
      const wd = await storage.getWorkDir(TEST_ROOM_NO_WD);
      expect(wd).toBeNull();
    });

    it('returns null for non-existent room', async () => {
      const wd = await storage.getWorkDir('non-existent-room-xyz');
      expect(wd).toBeNull();
    });

    it('caches results in roomWorkDirCache', async () => {
      storage.roomWorkDirCache.clear();
      await storage.getWorkDir(TEST_ROOM_ID);
      expect(storage.roomWorkDirCache.has(TEST_ROOM_ID)).toBe(true);
      expect(storage.roomWorkDirCache.get(TEST_ROOM_ID)).toBe(roomWorkDir);
    });

    it('returns cached value without re-reading file', async () => {
      storage.roomWorkDirCache.set(TEST_ROOM_ID, '/fake/cached/path');
      const wd = await storage.getWorkDir(TEST_ROOM_ID);
      expect(wd).toBe('/fake/cached/path');
    });
  });

  // ---- resolveRoomDataDir ----
  describe('resolveRoomDataDir', () => {
    it('returns workDir when set', async () => {
      const dir = await storage.resolveRoomDataDir(TEST_ROOM_ID);
      expect(dir).toBe(roomWorkDir);
    });

    it('returns rooms/{roomId}/ when no workDir', async () => {
      const dir = await storage.resolveRoomDataDir(TEST_ROOM_NO_WD);
      expect(dir).toBe(path.join(storage.ROOMS_DIR, TEST_ROOM_NO_WD));
    });
  });

  // ---- resolveTabDataDir ----
  describe('resolveTabDataDir', () => {
    it('returns workDir/{TabName}/ when workDir set', async () => {
      // Need tabs.json with a tab so resolveTabDataDir can find the tab name
      const tabsData = {
        tabs: [{ ...SAMPLE_TAB }],
        activeTabId: SAMPLE_TAB.id
      };
      fs.writeFileSync(path.join(roomWorkDir, 'tabs.json'), JSON.stringify(tabsData));

      const dir = await storage.resolveTabDataDir(TEST_ROOM_ID, SAMPLE_TAB.id);
      expect(dir).toBe(path.join(roomWorkDir, storage.sanitizeForFilesystem(SAMPLE_TAB.name)));
    });

    it('returns rooms/{roomId}/notes/{tabId}/ when no workDir', async () => {
      const dir = await storage.resolveTabDataDir(TEST_ROOM_NO_WD, 'tab-123');
      expect(dir).toBe(path.join(storage.ROOMS_DIR, TEST_ROOM_NO_WD, 'notes', 'tab-123'));
    });

    it('falls back to tabId when tab not found in tabs.json', async () => {
      // tabs.json exists but does not contain this tabId
      const dir = await storage.resolveTabDataDir(TEST_ROOM_ID, 'nonexistent-tab');
      expect(dir).toBe(path.join(roomWorkDir, 'nonexistent-tab'));
    });
  });

  // ---- initRoom ----
  describe('initRoom', () => {
    it('creates room directory and default tab (with workDir)', async () => {
      // Remove tabs.json to force creation
      const tabsPath = path.join(roomWorkDir, 'tabs.json');
      if (fs.existsSync(tabsPath)) fs.unlinkSync(tabsPath);
      storage.roomTabsCache.clear();

      await storage.initRoom(TEST_ROOM_ID);

      // Room dir in ROOMS_DIR should exist
      expect(fs.existsSync(path.join(storage.ROOMS_DIR, TEST_ROOM_ID))).toBe(true);
      // workDir should exist
      expect(fs.existsSync(roomWorkDir)).toBe(true);
      // tabs.json should be created with one tab
      const data = JSON.parse(fs.readFileSync(tabsPath, 'utf-8'));
      expect(data.tabs.length).toBe(1);
      expect(data.tabs[0].name).toBe('Main');
      expect(data.activeTabId).toBe(data.tabs[0].id);
    });

    it('does not overwrite existing tabs.json', async () => {
      // Write a custom tabs.json
      const tabsPath = path.join(roomWorkDir, 'tabs.json');
      const customData = { tabs: [{ ...SAMPLE_TAB }, { ...SAMPLE_TAB_2 }], activeTabId: SAMPLE_TAB.id };
      fs.writeFileSync(tabsPath, JSON.stringify(customData));
      storage.roomTabsCache.clear();

      await storage.initRoom(TEST_ROOM_ID);

      // tabs.json should still have 2 tabs
      const data = JSON.parse(fs.readFileSync(tabsPath, 'utf-8'));
      expect(data.tabs.length).toBe(2);
    });

    it('creates notes subdir for room without workDir', async () => {
      const roomDir = path.join(storage.ROOMS_DIR, TEST_ROOM_NO_WD);
      if (fs.existsSync(roomDir)) fs.rmSync(roomDir, { recursive: true, force: true });

      await storage.initRoom(TEST_ROOM_NO_WD);

      expect(fs.existsSync(path.join(roomDir, 'notes'))).toBe(true);
      // Should have created a tabs.json in the room dir
      expect(fs.existsSync(path.join(roomDir, 'tabs.json'))).toBe(true);
    });
  });

  // ---- Tab storage ----
  describe('readRoomTabs / writeRoomTabs', () => {
    it('writes and reads tabs.json', async () => {
      const tabsData = {
        tabs: [{ ...SAMPLE_TAB }],
        activeTabId: SAMPLE_TAB.id
      };

      await storage.writeRoomTabs(TEST_ROOM_ID, tabsData);
      storage.roomTabsCache.clear(); // Force re-read

      const read = await storage.readRoomTabs(TEST_ROOM_ID);
      expect(read.tabs.length).toBe(1);
      expect(read.tabs[0].id).toBe(SAMPLE_TAB.id);
      expect(read.activeTabId).toBe(SAMPLE_TAB.id);
    });

    it('returns null when no tabs.json exists', async () => {
      const result = await storage.readRoomTabs('totally-fake-room-id');
      expect(result).toBeNull();
    });

    it('caches read results', async () => {
      const tabsData = { tabs: [{ ...SAMPLE_TAB }], activeTabId: SAMPLE_TAB.id };
      await storage.writeRoomTabs(TEST_ROOM_ID, tabsData);

      // First read populates cache
      await storage.readRoomTabs(TEST_ROOM_ID);
      expect(storage.roomTabsCache.has(TEST_ROOM_ID)).toBe(true);

      // Modify file directly — cached read should return old data
      const tabsPath = path.join(roomWorkDir, 'tabs.json');
      const directData = { tabs: [{ ...SAMPLE_TAB }, { ...SAMPLE_TAB_2 }], activeTabId: SAMPLE_TAB.id };
      fs.writeFileSync(tabsPath, JSON.stringify(directData));

      const cached = await storage.readRoomTabs(TEST_ROOM_ID);
      expect(cached.tabs.length).toBe(1); // Still cached value
    });

    it('cache expires after TTL', async () => {
      const tabsData = { tabs: [{ ...SAMPLE_TAB }], activeTabId: SAMPLE_TAB.id };
      await storage.writeRoomTabs(TEST_ROOM_ID, tabsData);
      await storage.readRoomTabs(TEST_ROOM_ID);

      // Manually expire the cache
      const cached = storage.roomTabsCache.get(TEST_ROOM_ID);
      cached.expiry = Date.now() - 1;

      // Write different data directly
      const tabsPath = path.join(roomWorkDir, 'tabs.json');
      const newData = { tabs: [{ ...SAMPLE_TAB }, { ...SAMPLE_TAB_2 }], activeTabId: SAMPLE_TAB.id };
      fs.writeFileSync(tabsPath, JSON.stringify(newData));

      const fresh = await storage.readRoomTabs(TEST_ROOM_ID);
      expect(fresh.tabs.length).toBe(2);
    });

    it('writeRoomTabs invalidates cache', async () => {
      // Populate cache
      await storage.readRoomTabs(TEST_ROOM_ID);
      expect(storage.roomTabsCache.has(TEST_ROOM_ID)).toBe(true);

      // Write new data — should clear cache
      const newData = { tabs: [{ ...SAMPLE_TAB_2 }], activeTabId: SAMPLE_TAB_2.id };
      await storage.writeRoomTabs(TEST_ROOM_ID, newData);
      expect(storage.roomTabsCache.has(TEST_ROOM_ID)).toBe(false);
    });
  });

  describe('atomicUpdateRoomTabs', () => {
    it('atomically updates tabs', async () => {
      await storage.writeRoomTabs(TEST_ROOM_ID, {
        tabs: [{ ...SAMPLE_TAB }],
        activeTabId: SAMPLE_TAB.id
      });
      storage.roomTabsCache.clear();

      await storage.atomicUpdateRoomTabs(TEST_ROOM_ID, (data) => {
        data.tabs.push({ ...SAMPLE_TAB_2 });
      });

      storage.roomTabsCache.clear();
      const read = await storage.readRoomTabs(TEST_ROOM_ID);
      expect(read.tabs.length).toBe(2);
    });

    it('creates directory if it does not exist', async () => {
      // Use a fresh sub-path in workDir
      const subDir = path.join(roomWorkDir, 'subtabs');
      if (fs.existsSync(subDir)) fs.rmSync(subDir, { recursive: true, force: true });

      // atomicUpdateRoomTabs creates dir via preFn
      // But this only creates the workDir or room dir, not a subdir
      // This test verifies the preFn mkdir works
      await storage.atomicUpdateRoomTabs(TEST_ROOM_ID, (data) => {
        if (!data) return false; // null default, skip write
      });
      // The room workDir should still exist
      expect(fs.existsSync(roomWorkDir)).toBe(true);
    });

    it('invalidates cache after update', async () => {
      await storage.readRoomTabs(TEST_ROOM_ID);
      expect(storage.roomTabsCache.has(TEST_ROOM_ID)).toBe(true);

      await storage.atomicUpdateRoomTabs(TEST_ROOM_ID, (data) => {
        if (data && data.tabs) data.tabs[0].name = 'Renamed';
      });

      expect(storage.roomTabsCache.has(TEST_ROOM_ID)).toBe(false);
    });
  });

  // ---- Note storage ----
  describe('ensureTabDataDir', () => {
    it('creates directory if not exists and returns path', async () => {
      // Set up tabs.json so resolveTabDataDir can resolve tab name
      await storage.writeRoomTabs(TEST_ROOM_ID, {
        tabs: [{ ...SAMPLE_TAB }],
        activeTabId: SAMPLE_TAB.id
      });
      storage.roomTabsCache.clear();

      const tabDir = path.join(roomWorkDir, storage.sanitizeForFilesystem(SAMPLE_TAB.name));
      if (fs.existsSync(tabDir)) fs.rmSync(tabDir, { recursive: true, force: true });

      const dir = await storage.ensureTabDataDir(TEST_ROOM_ID, SAMPLE_TAB.id);
      expect(fs.existsSync(dir)).toBe(true);
      expect(dir).toBe(tabDir);
    });

    it('is a no-op if directory already exists', async () => {
      const dir = await storage.ensureTabDataDir(TEST_ROOM_ID, SAMPLE_TAB.id);
      // Call again — should not throw
      const dir2 = await storage.ensureTabDataDir(TEST_ROOM_ID, SAMPLE_TAB.id);
      expect(dir2).toBe(dir);
    });
  });

  describe('getNotesOrder / saveNotesOrder', () => {
    it('returns null when no _order.json exists', async () => {
      // Use a tab that has no data yet
      const fakeTabId = 'notes-order-test-' + crypto.randomBytes(4).toString('hex');
      const order = await storage.getNotesOrder(TEST_ROOM_ID, fakeTabId);
      expect(order).toBeNull();
    });

    it('saves and reads _order.json', async () => {
      await storage.writeRoomTabs(TEST_ROOM_ID, {
        tabs: [{ ...SAMPLE_TAB }],
        activeTabId: SAMPLE_TAB.id
      });
      storage.roomTabsCache.clear();

      const noteOrder = ['note-3', 'note-1', 'note-2'];
      await storage.saveNotesOrder(TEST_ROOM_ID, SAMPLE_TAB.id, noteOrder);

      storage.roomTabsCache.clear();
      const read = await storage.getNotesOrder(TEST_ROOM_ID, SAMPLE_TAB.id);
      expect(read).toEqual(noteOrder);
    });

    it('overwrites existing order', async () => {
      const first = ['a', 'b', 'c'];
      await storage.saveNotesOrder(TEST_ROOM_ID, SAMPLE_TAB.id, first);

      const second = ['c', 'a', 'b'];
      await storage.saveNotesOrder(TEST_ROOM_ID, SAMPLE_TAB.id, second);

      storage.roomTabsCache.clear();
      const read = await storage.getNotesOrder(TEST_ROOM_ID, SAMPLE_TAB.id);
      expect(read).toEqual(second);
    });
  });

  // ---- Scratch notes ----
  describe('scratch notes', () => {
    it('readScratchNotes returns [] if no file (tab scope)', async () => {
      const fakeTab = 'scratch-test-' + crypto.randomBytes(4).toString('hex');
      const notes = await storage.readScratchNotes(TEST_ROOM_ID, fakeTab);
      expect(notes).toEqual([]);
    });

    it('readScratchNotes returns [] if no file (global scope)', async () => {
      // Remove global-notes.json if present
      const gp = path.join(roomWorkDir, 'global-notes.json');
      if (fs.existsSync(gp)) fs.unlinkSync(gp);

      const notes = await storage.readScratchNotes(TEST_ROOM_ID, null);
      expect(notes).toEqual([]);
    });

    it('atomicUpdateScratchNotes creates and updates (tab scope)', async () => {
      await storage.writeRoomTabs(TEST_ROOM_ID, {
        tabs: [{ ...SAMPLE_TAB }],
        activeTabId: SAMPLE_TAB.id
      });
      storage.roomTabsCache.clear();

      await storage.atomicUpdateScratchNotes(TEST_ROOM_ID, SAMPLE_TAB.id, (data) => {
        data.push(SAMPLE_SCRATCH_NOTES[0]);
      });

      storage.roomTabsCache.clear();
      const notes = await storage.readScratchNotes(TEST_ROOM_ID, SAMPLE_TAB.id);
      expect(notes.length).toBe(1);
      expect(notes[0].id).toBe(SAMPLE_SCRATCH_NOTES[0].id);
    });

    it('atomicUpdateScratchNotes creates and updates (global scope)', async () => {
      // Clean up
      const gp = path.join(roomWorkDir, 'global-notes.json');
      if (fs.existsSync(gp)) fs.unlinkSync(gp);

      await storage.atomicUpdateScratchNotes(TEST_ROOM_ID, null, (data) => {
        data.push(SAMPLE_SCRATCH_NOTES[1]);
      });

      const notes = await storage.readScratchNotes(TEST_ROOM_ID, null);
      expect(notes.length).toBe(1);
      expect(notes[0].id).toBe(SAMPLE_SCRATCH_NOTES[1].id);
    });

    it('atomicUpdateScratchNotes appends to existing data', async () => {
      await storage.atomicUpdateScratchNotes(TEST_ROOM_ID, null, (data) => {
        data.push({ id: 'sn-extra', content: 'extra', severity: null, createdAt: Date.now() });
      });

      const notes = await storage.readScratchNotes(TEST_ROOM_ID, null);
      expect(notes.length).toBe(2);
    });
  });

  // ---- Credentials ----
  describe('credentials (tab scope)', () => {
    it('readCredentials returns [] if no file', async () => {
      const fakeTab = 'cred-test-' + crypto.randomBytes(4).toString('hex');
      const creds = await storage.readCredentials(TEST_ROOM_ID, fakeTab);
      expect(creds).toEqual([]);
    });

    it('atomicUpdateCredentials creates and updates', async () => {
      await storage.writeRoomTabs(TEST_ROOM_ID, {
        tabs: [{ ...SAMPLE_TAB }],
        activeTabId: SAMPLE_TAB.id
      });
      storage.roomTabsCache.clear();

      await storage.atomicUpdateCredentials(TEST_ROOM_ID, SAMPLE_TAB.id, (data) => {
        data.push(SAMPLE_CREDENTIALS[0]);
      });

      storage.roomTabsCache.clear();
      const creds = await storage.readCredentials(TEST_ROOM_ID, SAMPLE_TAB.id);
      expect(creds.length).toBe(1);
      expect(creds[0].id).toBe(SAMPLE_CREDENTIALS[0].id);
    });

    it('getCredentialsPath returns correct path', async () => {
      await storage.writeRoomTabs(TEST_ROOM_ID, {
        tabs: [{ ...SAMPLE_TAB }],
        activeTabId: SAMPLE_TAB.id
      });
      storage.roomTabsCache.clear();

      const fp = await storage.getCredentialsPath(TEST_ROOM_ID, SAMPLE_TAB.id);
      const tabName = storage.sanitizeForFilesystem(SAMPLE_TAB.name);
      expect(fp).toBe(path.join(roomWorkDir, tabName, 'credentials.json'));
    });
  });

  describe('credentials (global scope)', () => {
    it('readGlobalCredentials returns [] if no file', async () => {
      const gp = path.join(roomWorkDir, 'credentials.json');
      if (fs.existsSync(gp)) fs.unlinkSync(gp);

      const creds = await storage.readGlobalCredentials(TEST_ROOM_ID);
      expect(creds).toEqual([]);
    });

    it('atomicUpdateGlobalCredentials creates and updates', async () => {
      const gp = path.join(roomWorkDir, 'credentials.json');
      if (fs.existsSync(gp)) fs.unlinkSync(gp);

      await storage.atomicUpdateGlobalCredentials(TEST_ROOM_ID, (data) => {
        data.push(SAMPLE_CREDENTIALS[1]);
      });

      const creds = await storage.readGlobalCredentials(TEST_ROOM_ID);
      expect(creds.length).toBe(1);
      expect(creds[0].id).toBe(SAMPLE_CREDENTIALS[1].id);
    });

    it('getGlobalCredentialsPath returns correct path', async () => {
      const fp = await storage.getGlobalCredentialsPath(TEST_ROOM_ID);
      expect(fp).toBe(path.join(roomWorkDir, 'credentials.json'));
    });
  });

  // ---- Global variables ----
  describe('global variables', () => {
    it('readGlobalVariables returns {} if no file', async () => {
      const gp = path.join(roomWorkDir, 'global-variables.json');
      if (fs.existsSync(gp)) fs.unlinkSync(gp);

      const vars = await storage.readGlobalVariables(TEST_ROOM_ID);
      expect(vars).toEqual({});
    });

    it('atomicUpdateGlobalVariables creates and updates', async () => {
      const gp = path.join(roomWorkDir, 'global-variables.json');
      if (fs.existsSync(gp)) fs.unlinkSync(gp);

      await storage.atomicUpdateGlobalVariables(TEST_ROOM_ID, (data) => {
        Object.assign(data, SAMPLE_GLOBAL_VARIABLES);
      });

      const vars = await storage.readGlobalVariables(TEST_ROOM_ID);
      expect(vars.Domain).toBe('corp.local');
      expect(vars.DNSServer).toBe('10.10.10.1');
      expect(vars.Wordlist).toBe('/usr/share/wordlists/rockyou.txt');
    });

    it('atomicUpdateGlobalVariables merges with existing data', async () => {
      await storage.atomicUpdateGlobalVariables(TEST_ROOM_ID, (data) => {
        data.NewVar = 'newvalue';
      });

      const vars = await storage.readGlobalVariables(TEST_ROOM_ID);
      expect(vars.Domain).toBe('corp.local'); // still present
      expect(vars.NewVar).toBe('newvalue');
    });
  });

  // ---- Alerts ----
  describe('alerts', () => {
    const sampleAlerts = [
      { id: 'alert-1', nickname: 'user1', context: 'tab', title: 'Found creds', preview: 'admin:pass', timestamp: Date.now() },
      { id: 'alert-2', nickname: 'user2', context: 'scratch', title: 'Open port', preview: '8080', timestamp: Date.now() }
    ];

    it('readAlerts returns [] if no file', async () => {
      const fp = path.join(roomWorkDir, 'alerts.json');
      if (fs.existsSync(fp)) fs.unlinkSync(fp);

      const alerts = await storage.readAlerts(TEST_ROOM_ID);
      expect(alerts).toEqual([]);
    });

    it('writeAlerts writes array to file', async () => {
      await storage.writeAlerts(TEST_ROOM_ID, sampleAlerts);

      const alerts = await storage.readAlerts(TEST_ROOM_ID);
      expect(alerts.length).toBe(2);
      expect(alerts[0].id).toBe('alert-1');
      expect(alerts[1].id).toBe('alert-2');
    });

    it('writeAlerts overwrites existing data', async () => {
      await storage.writeAlerts(TEST_ROOM_ID, [sampleAlerts[0]]);
      const alerts = await storage.readAlerts(TEST_ROOM_ID);
      expect(alerts.length).toBe(1);
    });

    it('atomicUpdateAlerts creates and updates', async () => {
      const fp = path.join(roomWorkDir, 'alerts.json');
      if (fs.existsSync(fp)) fs.unlinkSync(fp);

      await storage.atomicUpdateAlerts(TEST_ROOM_ID, (data) => {
        data.push(sampleAlerts[0]);
      });

      const alerts = await storage.readAlerts(TEST_ROOM_ID);
      expect(alerts.length).toBe(1);
      expect(alerts[0].id).toBe('alert-1');
    });

    it('atomicUpdateAlerts appends to existing data', async () => {
      await storage.atomicUpdateAlerts(TEST_ROOM_ID, (data) => {
        data.push(sampleAlerts[1]);
      });

      const alerts = await storage.readAlerts(TEST_ROOM_ID);
      expect(alerts.length).toBe(2);
    });

    it('writeAlerts sets restrictive permissions (0o600)', async () => {
      await storage.writeAlerts(TEST_ROOM_ID, sampleAlerts);
      const fp = path.join(roomWorkDir, 'alerts.json');
      const stat = fs.statSync(fp);
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });
});
