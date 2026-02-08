'use strict';

const request = require('supertest');
const crypto = require('crypto');
const path = require('path');
const fsp = require('fs').promises;
const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestAppMulti } = require('../helpers/test-app');

let ctx, app;

// We need rooms + tabs + session routes for full flow
beforeAll(async () => {
  ctx = await createMockContext();
  app = createTestAppMulti([
    require('../../routes/rooms'),
    require('../../routes/tabs'),
    require('../../routes/session')
  ], ctx.routeCtx);
});

afterAll(async () => {
  await cleanup(ctx);
});

beforeEach(() => {
  ctx.clearBroadcasts();
  ctx.storage.roomWorkDirCache.clear();
  ctx.storage.roomTabsCache.clear();
});

// ---------------------------------------------------------------------------
// Helper: create a room and return { roomId, token }
// ---------------------------------------------------------------------------
async function createRoom(overrides = {}) {
  const workDir = path.join(ctx.tempDir, 'session-wd-' + crypto.randomBytes(4).toString('hex'));
  const res = await request(app)
    .post('/api/rooms')
    .send({
      name: overrides.name || 'SessionTestRoom',
      password: overrides.password || 'password123',
      nickname: overrides.nickname || 'creator',
      workDir
    })
    .expect(201);

  return {
    roomId: res.body.room.id,
    token: res.body.token,
    nickname: res.body.nickname,
    workDir
  };
}

async function joinRoom(roomId, password, nickname) {
  const res = await request(app)
    .post(`/api/rooms/${roomId}/join`)
    .send({ password, nickname })
    .expect(200);
  return { token: res.body.token, nickname: res.body.nickname };
}

// ===========================================================================
// POST /api/session/reset
// ===========================================================================
describe('POST /api/session/reset', () => {
  test('creator can reset session', async () => {
    const { token } = await createRoom();

    // Create a second tab
    await request(app)
      .post('/api/tabs')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ExtraTab' })
      .expect(201);

    // Verify we have 2 tabs
    const tabsRes = await request(app)
      .get('/api/tabs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(tabsRes.body.tabs.length).toBe(2);

    // Reset session
    const res = await request(app)
      .post('/api/session/reset')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Should return fresh session with 1 tab named "Main"
    expect(res.body.tabs).toBeDefined();
    expect(res.body.tabs.length).toBe(1);
    expect(res.body.tabs[0].name).toBe('Main');
    expect(res.body.activeTabId).toBe(res.body.tabs[0].id);
  });

  test('broadcasts session-reset event', async () => {
    const { token } = await createRoom();
    ctx.clearBroadcasts();

    await request(app)
      .post('/api/session/reset')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const bc = ctx.broadcasts.find(b => b.event.type === 'session-reset');
    expect(bc).toBeDefined();
  });

  test('non-creator cannot reset session', async () => {
    const { roomId } = await createRoom({ password: 'password123' });

    // Join as a different user
    const { token: joinerToken } = await joinRoom(roomId, 'password123', 'joiner');

    const res = await request(app)
      .post('/api/session/reset')
      .set('Authorization', `Bearer ${joinerToken}`)
      .expect(403);

    expect(res.body.error).toMatch(/creator/i);
  });

  test('resets tab data directories', async () => {
    const { token, workDir } = await createRoom();

    // Create a tab and add a file to its data directory
    await request(app)
      .post('/api/tabs')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'DataTab' })
      .expect(201);

    const tabDir = path.join(workDir, 'DataTab');
    // Write a test file in the tab directory
    await fsp.writeFile(path.join(tabDir, 'test-note.md'), '# Test note');

    // Verify the file exists
    const before = await fsp.stat(path.join(tabDir, 'test-note.md')).catch(() => null);
    expect(before).not.toBeNull();

    // Reset
    await request(app)
      .post('/api/session/reset')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // The old tab data directory should be removed
    const after = await fsp.stat(tabDir).catch(() => null);
    expect(after).toBeNull();
  });

  test('creates new tab data directory after reset', async () => {
    const { token, workDir } = await createRoom();

    await request(app)
      .post('/api/session/reset')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // The new "Main" tab should have its directory created
    const newTabDir = path.join(workDir, 'Main');
    const stat = await fsp.stat(newTabDir).catch(() => null);
    expect(stat).not.toBeNull();
    expect(stat.isDirectory()).toBe(true);
  });

  test('fresh session has proper tab structure', async () => {
    const { token } = await createRoom();

    const res = await request(app)
      .post('/api/session/reset')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const tab = res.body.tabs[0];
    expect(tab.id).toMatch(/^[a-f0-9]{8,16}$/);
    expect(tab.name).toBe('Main');
    expect(tab.activeNoteId).toBeNull();
    expect(tab.variables).toEqual({});
    expect(tab.commandHistory).toEqual([]);
    expect(tab.status).toBeNull();
  });

  test('requires authentication', async () => {
    await request(app)
      .post('/api/session/reset')
      .expect(401);
  });

  test('cleans up PTY processes on reset', async () => {
    const { roomId, token } = await createRoom();

    // Set up mock PTY entry
    const ptyKey = `${roomId}:tab1:0`;
    const mockKill = vi.fn();
    const mockClient = { readyState: 1, close: vi.fn() };
    ctx.routeCtx.ptyProcesses.set(ptyKey, {
      pty: { kill: mockKill },
      clients: new Set([mockClient]),
      buffer: []
    });

    // Register in secondary index
    ctx.routeCtx.roomPtyKeys.set(roomId, new Set([ptyKey]));

    // Reset session
    await request(app)
      .post('/api/session/reset')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // PTY should have been killed
    expect(mockKill).toHaveBeenCalled();
    // Client should have been closed
    expect(mockClient.close).toHaveBeenCalled();
    // Maps should be cleaned up
    expect(ctx.routeCtx.ptyProcesses.has(ptyKey)).toBe(false);
    expect(ctx.routeCtx.roomPtyKeys.has(roomId)).toBe(false);
  });

  test('subsequent tab operations work after reset', async () => {
    const { token } = await createRoom();

    // Reset
    await request(app)
      .post('/api/session/reset')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Should be able to create new tabs after reset
    const tabRes = await request(app)
      .post('/api/tabs')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'PostReset' })
      .expect(201);

    expect(tabRes.body.name).toBe('PostReset');

    // List should show Main + PostReset
    const listRes = await request(app)
      .get('/api/tabs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listRes.body.tabs.length).toBe(2);
  });
});
