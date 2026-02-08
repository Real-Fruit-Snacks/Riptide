'use strict';

const request = require('supertest');
const crypto = require('crypto');
const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestAppMulti } = require('../helpers/test-app');

// ---------------------------------------------------------------------------
// Security tests for room isolation and creator-only authorization.
//
// Room isolation: verifies that a user authenticated in Room A cannot access
// any data belonging to Room B (tabs, notes, credentials, history, scratch
// notes, variables).  The enforcement boundary is the requireRoom middleware
// (resolves req.roomId from token) combined with validateTabId (checks tab
// membership in that room's tabs.json).
//
// Creator authorization: verifies which room-management endpoints enforce
// creator-only access and which allow any room member.
// ---------------------------------------------------------------------------

let ctx, app;

beforeAll(async () => {
  ctx = await createMockContext();

  // Mount all route modules that handle room-scoped data so we can test
  // cross-room access attempts against every endpoint family.
  app = createTestAppMulti([
    require('../../routes/rooms'),
    require('../../routes/tabs'),
    require('../../routes/notes'),
    require('../../routes/credentials'),
    require('../../routes/history'),
    require('../../routes/scratch-notes'),
    require('../../routes/variables')
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
// Helpers
// ---------------------------------------------------------------------------
async function createRoom(overrides = {}) {
  const body = {
    name: overrides.name || 'Room ' + crypto.randomBytes(3).toString('hex'),
    password: overrides.password || 'password123',
    nickname: overrides.nickname || 'creator'
  };

  const res = await request(app)
    .post('/api/rooms')
    .send(body)
    .expect(201);

  return {
    roomId: res.body.room.id,
    token: res.body.token,
    nickname: res.body.nickname,
    room: res.body.room
  };
}

async function joinRoom(roomId, password, nickname) {
  const res = await request(app)
    .post(`/api/rooms/${roomId}/join`)
    .send({ password, nickname })
    .expect(200);

  return { token: res.body.token, nickname: res.body.nickname };
}

// Create a tab in a room and return its ID
async function createTab(token, name) {
  const res = await request(app)
    .post('/api/tabs')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: name || 'Target' })
    .expect(201);

  return res.body.id;
}

// Create a note in a tab and return its ID
async function createNote(token, tabId, title) {
  const res = await request(app)
    .post(`/api/tabs/${tabId}/notes`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: title || 'Test Note', content: '# Test\n\nContent' })
    .expect(201);

  return res.body.id;
}

// Create a tab credential and return its ID
async function createCredential(token, tabId) {
  const res = await request(app)
    .post(`/api/tabs/${tabId}/credentials`)
    .set('Authorization', `Bearer ${token}`)
    .send({ service: 'ssh', username: 'root', password: 'secret123' })
    .expect(200);

  return res.body.credential.id;
}

// Create a scratch note and return its ID
async function createScratchNote(token, tabId) {
  const res = await request(app)
    .post('/api/scratch-notes')
    .set('Authorization', `Bearer ${token}`)
    .send({ scope: 'tab', tabId, text: 'scratch note content' })
    .expect(200);

  return res.body.entry.id;
}

// Log a command in history
async function logCommand(token, tabId, command) {
  await request(app)
    .post(`/api/tabs/${tabId}/history`)
    .set('Authorization', `Bearer ${token}`)
    .send({ command: command || 'nmap -sV 10.0.0.1' })
    .expect(200);
}

// ===========================================================================
// ROOM ISOLATION TESTS
// ===========================================================================
describe('Room Isolation', () => {
  let roomA, roomB, tabIdB, noteIdB, credIdB;

  beforeAll(async () => {
    // Create two independent rooms with different creators
    roomA = await createRoom({ name: 'Room Alpha', nickname: 'alice' });
    roomB = await createRoom({ name: 'Room Beta', nickname: 'bob' });

    // Populate Room B with data that Room A should NOT be able to access
    tabIdB = await createTab(roomB.token, 'BetaTarget');
    noteIdB = await createNote(roomB.token, tabIdB, 'Secret Note');
    credIdB = await createCredential(roomB.token, tabIdB);
    await createScratchNote(roomB.token, tabIdB);
    await logCommand(roomB.token, tabIdB, 'cat /etc/shadow');

    // Set global variables in Room B
    await request(app)
      .patch('/api/variables')
      .set('Authorization', `Bearer ${roomB.token}`)
      .send({ variables: { TargetIP: '10.0.0.99' } })
      .expect(200);

    // Create a global credential in Room B
    await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${roomB.token}`)
      .send({ service: 'global-ssh', username: 'admin', password: 'globalpass' })
      .expect(200);

    // Create a global scratch note in Room B
    await request(app)
      .post('/api/scratch-notes')
      .set('Authorization', `Bearer ${roomB.token}`)
      .send({ scope: 'global', text: 'global finding in Room B' })
      .expect(200);
  });

  // -------------------------------------------------------------------------
  // Tab isolation
  // -------------------------------------------------------------------------
  describe('Tab access across rooms', () => {
    test('user in Room A cannot see Room B tabs in their tab list', async () => {
      const res = await request(app)
        .get('/api/tabs')
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(200);

      // Room A's tab list should not contain Room B's tab
      const tabIds = res.body.tabs.map(t => t.id);
      expect(tabIds).not.toContain(tabIdB);
    });

    test('user in Room A cannot PATCH a tab belonging to Room B', async () => {
      await request(app)
        .patch(`/api/tabs/${tabIdB}`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    test('user in Room A cannot DELETE a tab belonging to Room B', async () => {
      // Room A has only 1 tab (the default), so DELETE returns 400 "last tab"
      // before it even looks up tabIdB. Either way, Room B's tab is safe.
      const res = await request(app)
        .delete(`/api/tabs/${tabIdB}`)
        .set('Authorization', `Bearer ${roomA.token}`);

      // Accept 400 (last-tab guard) or 404 (tab not found) — both prevent deletion
      expect([400, 404]).toContain(res.status);
    });
  });

  // -------------------------------------------------------------------------
  // Note isolation
  // -------------------------------------------------------------------------
  describe('Note access across rooms', () => {
    test('user in Room A cannot GET notes list from Room B tab', async () => {
      await request(app)
        .get(`/api/tabs/${tabIdB}/notes`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(404);
    });

    test('user in Room A cannot GET a specific note from Room B tab', async () => {
      await request(app)
        .get(`/api/tabs/${tabIdB}/notes/${noteIdB}`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(404);
    });

    test('user in Room A cannot PUT (update) a note in Room B tab', async () => {
      await request(app)
        .put(`/api/tabs/${tabIdB}/notes/${noteIdB}`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .send({ content: 'overwritten by attacker' })
        .expect(404);
    });

    test('user in Room A cannot POST a new note to Room B tab', async () => {
      await request(app)
        .post(`/api/tabs/${tabIdB}/notes`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .send({ title: 'Injected Note' })
        .expect(404);
    });

    test('user in Room A cannot DELETE a note in Room B tab', async () => {
      await request(app)
        .delete(`/api/tabs/${tabIdB}/notes/${noteIdB}`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(404);
    });

    test('user in Room A cannot append to a note in Room B tab', async () => {
      await request(app)
        .post(`/api/tabs/${tabIdB}/notes/${noteIdB}/append`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .send({ content: '\n\ninjected content' })
        .expect(404);
    });

    test('user in Room A cannot change note severity in Room B tab', async () => {
      await request(app)
        .patch(`/api/tabs/${tabIdB}/notes/${noteIdB}/severity`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .send({ severity: 'critical' })
        .expect(404);
    });

    test('user in Room A cannot reorder notes in Room B tab', async () => {
      await request(app)
        .put(`/api/tabs/${tabIdB}/notes/order`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .send({ order: [noteIdB] })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // Tab credential isolation
  // -------------------------------------------------------------------------
  describe('Tab credential access across rooms', () => {
    test('user in Room A cannot GET credentials from Room B tab', async () => {
      await request(app)
        .get(`/api/tabs/${tabIdB}/credentials`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(404);
    });

    test('user in Room A cannot POST credentials to Room B tab', async () => {
      await request(app)
        .post(`/api/tabs/${tabIdB}/credentials`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .send({ service: 'ftp', username: 'hacker', password: 'injected' })
        .expect(404);
    });

    test('user in Room A cannot PUT (update) a credential in Room B tab', async () => {
      await request(app)
        .put(`/api/tabs/${tabIdB}/credentials/${credIdB}`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .send({ password: 'overwritten' })
        .expect(404);
    });

    test('user in Room A cannot DELETE a credential from Room B tab', async () => {
      await request(app)
        .delete(`/api/tabs/${tabIdB}/credentials/${credIdB}`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // Global credential isolation
  // -------------------------------------------------------------------------
  describe('Global credential access across rooms', () => {
    test('user in Room A cannot see Room B global credentials', async () => {
      const res = await request(app)
        .get('/api/credentials')
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(200);

      // Room A should have zero global credentials (we only added to Room B)
      expect(res.body).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // History isolation
  // -------------------------------------------------------------------------
  describe('History access across rooms', () => {
    test('user in Room A cannot GET history from Room B tab', async () => {
      await request(app)
        .get(`/api/tabs/${tabIdB}/history`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(404);
    });

    test('user in Room A cannot POST history to Room B tab', async () => {
      await request(app)
        .post(`/api/tabs/${tabIdB}/history`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .send({ command: 'malicious command' })
        .expect(404);
    });

    test('user in Room A cannot DELETE history from Room B tab', async () => {
      await request(app)
        .delete(`/api/tabs/${tabIdB}/history`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // Scratch note isolation
  // -------------------------------------------------------------------------
  describe('Scratch note access across rooms', () => {
    test('user in Room A cannot GET tab-scoped scratch notes from Room B', async () => {
      const res = await request(app)
        .get(`/api/scratch-notes?scope=tab&tabId=${tabIdB}`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(404);

      // The tab doesn't exist in Room A, so validateTabId-like check in
      // scratch-notes route returns 404
      expect(res.body.error).toMatch(/tab not found/i);
    });

    test('user in Room A cannot see Room B global scratch notes', async () => {
      const res = await request(app)
        .get('/api/scratch-notes?scope=global')
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(200);

      // Room A has no global scratch notes
      expect(res.body).toEqual([]);
    });

    test('user in Room A cannot POST tab scratch note to Room B tab', async () => {
      await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${roomA.token}`)
        .send({ scope: 'tab', tabId: tabIdB, text: 'injected scratch' })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // Variable isolation
  // -------------------------------------------------------------------------
  describe('Variable access across rooms', () => {
    test('user in Room A cannot see Room B global variables', async () => {
      const res = await request(app)
        .get('/api/variables')
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(200);

      // Room A has no global variables; Room B's TargetIP should not appear
      expect(res.body.TargetIP).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Room management isolation (cross-room ID mismatch)
  // -------------------------------------------------------------------------
  describe('Room management across rooms', () => {
    test('user in Room A cannot PATCH (rename) Room B', async () => {
      await request(app)
        .patch(`/api/rooms/${roomB.roomId}`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .send({ name: 'Hijacked Name' })
        .expect(403);
    });

    test('user in Room A cannot DELETE Room B', async () => {
      await request(app)
        .delete(`/api/rooms/${roomB.roomId}`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .expect(403);
    });

    test('user in Room A exporting with Room B ID gets own room data, not Room B data', async () => {
      // The export route uses req.roomId (from token = Room A), NOT req.params.id.
      // So the response is a ZIP of Room A's data — Room B's data is never exposed.
      const res = await request(app)
        .get(`/api/rooms/${roomB.roomId}/export`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .responseType('blob')
        .expect(200);

      // Verify it exported Room A's data (which has the default tab, not BetaTarget)
      expect(res.headers['content-type']).toMatch(/application\/zip/);
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(res.body);
      // Room A's tabs.json should not contain Room B's tab name
      const tabsEntry = zip.getEntry('tabs.json');
      if (tabsEntry) {
        const tabsContent = tabsEntry.getData().toString('utf-8');
        expect(tabsContent).not.toContain('BetaTarget');
      }
    });

    test('user in Room A importing with Room B ID writes to own room, not Room B', async () => {
      // The import route uses req.roomId (from token = Room A), NOT req.params.id.
      // So the data is imported into Room A's directory — Room B is unaffected.
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      zip.addFile('import-marker.txt', Buffer.from('from room A'));

      await request(app)
        .post(`/api/rooms/${roomB.roomId}/import`)
        .set('Authorization', `Bearer ${roomA.token}`)
        .set('Content-Type', 'application/octet-stream')
        .send(zip.toBuffer())
        .expect(200);

      // Verify Room B's data is unchanged (checked in integrity tests below)
    });
  });

  // -------------------------------------------------------------------------
  // Verify Room B data is still intact after all cross-room attempts
  // -------------------------------------------------------------------------
  describe('Room B data integrity after cross-room attempts', () => {
    test('Room B note content is unchanged', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabIdB}/notes/${noteIdB}`)
        .set('Authorization', `Bearer ${roomB.token}`)
        .expect(200);

      expect(res.body.content).toBe('# Test\n\nContent');
    });

    test('Room B credentials are unchanged', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabIdB}/credentials`)
        .set('Authorization', `Bearer ${roomB.token}`)
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(credIdB);
      expect(res.body[0].username).toBe('root');
    });

    test('Room B history is unchanged', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabIdB}/history`)
        .set('Authorization', `Bearer ${roomB.token}`)
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].command).toBe('cat /etc/shadow');
    });

    test('Room B tab still exists with original name', async () => {
      const res = await request(app)
        .get('/api/tabs')
        .set('Authorization', `Bearer ${roomB.token}`)
        .expect(200);

      const tab = res.body.tabs.find(t => t.id === tabIdB);
      expect(tab).toBeDefined();
      expect(tab.name).toBe('BetaTarget');
    });

    test('Room B global variables are unchanged', async () => {
      const res = await request(app)
        .get('/api/variables')
        .set('Authorization', `Bearer ${roomB.token}`)
        .expect(200);

      expect(res.body.TargetIP).toBe('10.0.0.99');
    });
  });
});

// ===========================================================================
// CREATOR-ONLY AUTHORIZATION TESTS
// ===========================================================================
describe('Creator-Only Authorization', () => {
  let creatorData, joinerToken;

  beforeAll(async () => {
    creatorData = await createRoom({
      name: 'Creator Auth Room',
      password: 'password123',
      nickname: 'owner'
    });

    const joined = await joinRoom(creatorData.roomId, 'password123', 'member');
    joinerToken = joined.token;
  });

  describe('DELETE /api/rooms/:id (creator-only)', () => {
    // This is already tested in rooms.test.js but included here for
    // completeness of the security test suite.
    test('non-creator cannot delete room', async () => {
      await request(app)
        .delete(`/api/rooms/${creatorData.roomId}`)
        .set('Authorization', `Bearer ${joinerToken}`)
        .expect(403);
    });

    test('creator can delete room', async () => {
      // Create a disposable room to test deletion
      const disposable = await createRoom({
        name: 'Disposable',
        password: 'password123',
        nickname: 'downer'
      });

      await request(app)
        .delete(`/api/rooms/${disposable.roomId}`)
        .set('Authorization', `Bearer ${disposable.token}`)
        .expect(200);
    });
  });

  describe('PATCH /api/rooms/:id (any room member)', () => {
    // The PATCH route only checks req.roomId === req.params.id (same room)
    // but does NOT enforce creator-only access. This means any room member
    // can rename the room. This test documents the current behavior.
    test('non-creator CAN rename the room (no creator-only check)', async () => {
      const res = await request(app)
        .patch(`/api/rooms/${creatorData.roomId}`)
        .set('Authorization', `Bearer ${joinerToken}`)
        .send({ name: 'Renamed by Member' })
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.name).toBe('Renamed by Member');
    });

    test('user from a different room still cannot rename', async () => {
      const otherRoom = await createRoom({
        name: 'Other Room',
        nickname: 'outsider'
      });

      await request(app)
        .patch(`/api/rooms/${creatorData.roomId}`)
        .set('Authorization', `Bearer ${otherRoom.token}`)
        .send({ name: 'Hijacked' })
        .expect(403);
    });
  });

  describe('POST /api/rooms/:id/import (any room member)', () => {
    // Import also only checks requireRoom (same room), no creator check.
    // This test documents the current behavior.
    test('non-creator CAN import data (no creator-only check)', async () => {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      const tabsContent = JSON.stringify({
        tabs: [{ id: 'abcd1234', name: 'Imported', activeNoteId: null, variables: {}, commandHistory: [], status: null }],
        activeTabId: 'abcd1234'
      });
      zip.addFile('tabs.json', Buffer.from(tabsContent));

      const res = await request(app)
        .post(`/api/rooms/${creatorData.roomId}/import`)
        .set('Authorization', `Bearer ${joinerToken}`)
        .set('Content-Type', 'application/octet-stream')
        .send(zip.toBuffer())
        .expect(200);

      expect(res.body.ok).toBe(true);
    });

    test('user from a different room importing with this room ID writes to their own room', async () => {
      // Import uses req.roomId (from token), not req.params.id.
      // So the outsider's data goes to their own room, not the target room.
      const otherRoom = await createRoom({
        name: 'Import Outsider',
        nickname: 'outsider'
      });

      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      zip.addFile('outsider-marker.txt', Buffer.from('payload'));

      const res = await request(app)
        .post(`/api/rooms/${creatorData.roomId}/import`)
        .set('Authorization', `Bearer ${otherRoom.token}`)
        .set('Content-Type', 'application/octet-stream')
        .send(zip.toBuffer())
        .expect(200);

      expect(res.body.ok).toBe(true);
      // The data was imported into the outsider's room, not creatorData's room
    });
  });
});
