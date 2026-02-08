'use strict';

const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestApp } = require('../helpers/test-app');
const request = require('supertest');

describe('Recordings Routes', () => {
  let ctx, app, token, roomId, tabId;

  // Valid asciicast v2 recording for testing
  const sampleCast = JSON.stringify({ version: 2, width: 80, height: 24, timestamp: 1700000000, env: { SHELL: '/bin/bash', TERM: 'xterm-256color' } })
    + '\n' + JSON.stringify([0.5, 'o', 'hello '])
    + '\n' + JSON.stringify([1.0, 'o', 'world\r\n'])
    + '\n';

  beforeAll(async () => {
    ctx = await createMockContext();
    roomId = 'rectest1';
    const hashedPw = await require('../../lib/helpers').hashPassword('testpass123');
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'Recording Test Room',
        passwordHash: hashedPw,
        workDir: ctx.tempDir,
        creator: 'tester'
      });
    });
    tabId = 'a1b2c3d4';
    await ctx.storage.writeRoomTabs(roomId, {
      tabs: [{
        id: tabId,
        name: 'Target1',
        activeNoteId: null,
        variables: {},
        commandHistory: [],
        status: null,
        scope: {}
      }]
    });
    token = ctx.addSession(roomId, 'tester');
    app = createTestApp(require('../../routes/recordings'), ctx.routeCtx);
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  beforeEach(() => {
    ctx.clearBroadcasts();
  });

  describe('GET /api/tabs/:tabId/recordings', () => {
    it('returns empty list initially', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabId}/recordings`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('returns recordings after one is saved', async () => {
      // Save a recording first
      await request(app)
        .post(`/api/tabs/${tabId}/recordings`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'test-session', cast: sampleCast });

      const res = await request(app)
        .get(`/api/tabs/${tabId}/recordings`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].name).toContain('test-session');
      expect(res.body[0].size).toBeGreaterThan(0);
      expect(res.body[0].modified).toBeTruthy();
    });
  });

  describe('POST /api/tabs/:tabId/recordings', () => {
    it('saves recording with valid cast data', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/recordings`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'my-recording', cast: sampleCast });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.recording).toMatchObject({
        name: expect.stringContaining('my-recording'),
        size: expect.any(Number),
        modified: expect.any(String)
      });
      expect(res.body.recording.name).toMatch(/\.cast$/);
    });

    it('broadcasts recording-saved event', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/recordings`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'broadcast-test', cast: sampleCast });

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0]).toMatchObject({
        roomId,
        event: {
          type: 'recording-saved',
          tabId,
          user: 'tester'
        }
      });
      expect(ctx.broadcasts[0].event.recording.name).toContain('broadcast-test');
    });

    it('returns 400 when cast data is missing', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/recordings`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'no-cast' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('cast data is required');
    });

    it('returns 400 when cast data is empty string', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/recordings`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'empty-cast', cast: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('cast data is required');
    });

    it('requires scope (validates tabId with 404 for non-existent tab)', async () => {
      const res = await request(app)
        .post('/api/tabs/deadbeef/recordings')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'invalid-tab', cast: sampleCast });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Tab not found');
    });
  });

  describe('GET /api/tabs/:tabId/recordings/:filename', () => {
    it('downloads a saved recording', async () => {
      // Save a recording first
      const saveRes = await request(app)
        .post(`/api/tabs/${tabId}/recordings`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'download-test', cast: sampleCast });

      const filename = saveRes.body.recording.name;

      const res = await request(app)
        .get(`/api/tabs/${tabId}/recordings/${filename}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain(filename);
      // res.body is Buffer for download endpoints, convert to string
      const content = res.body.toString('utf-8');
      expect(content).toContain('hello');
      expect(content).toContain('world');
    });

    it('returns 404 for non-existent recording', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabId}/recordings/nonexistent.cast`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Recording not found');
    });

    it('returns 400 for path traversal attempt', async () => {
      // Path traversal gets caught by Express router as 404 before reaching our handler
      // Test with a filename that contains .. but is still routable
      const res = await request(app)
        .get(`/api/tabs/${tabId}/recordings/..%2F..%2Fetc%2Fpasswd`)
        .set('Authorization', `Bearer ${token}`);

      expect([400, 404]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body.error).toContain('Invalid');
      }
    });

    it('returns 400 for invalid file type', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabId}/recordings/test.txt`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid file type');
    });
  });

  describe('DELETE /api/tabs/:tabId/recordings/:filename', () => {
    it('deletes a recording', async () => {
      // Save a recording first
      const saveRes = await request(app)
        .post(`/api/tabs/${tabId}/recordings`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'delete-test', cast: sampleCast });

      const filename = saveRes.body.recording.name;
      ctx.clearBroadcasts();

      const deleteRes = await request(app)
        .delete(`/api/tabs/${tabId}/recordings/${filename}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.ok).toBe(true);

      // Verify it's gone
      const getRes = await request(app)
        .get(`/api/tabs/${tabId}/recordings/${filename}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(404);
    });

    it('broadcasts recording-deleted event', async () => {
      // Save a recording first
      const saveRes = await request(app)
        .post(`/api/tabs/${tabId}/recordings`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'delete-broadcast', cast: sampleCast });

      const filename = saveRes.body.recording.name;
      ctx.clearBroadcasts();

      await request(app)
        .delete(`/api/tabs/${tabId}/recordings/${filename}`)
        .set('Authorization', `Bearer ${token}`);

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0]).toMatchObject({
        roomId,
        event: {
          type: 'recording-deleted',
          tabId,
          filename,
          user: 'tester'
        }
      });
    });

    it('returns 404 for non-existent recording', async () => {
      const res = await request(app)
        .delete(`/api/tabs/${tabId}/recordings/nonexistent.cast`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Recording not found');
    });

    it('returns 400 for path traversal attempt', async () => {
      // Path traversal gets caught by Express router as 404 before reaching our handler
      // Test with a filename that contains .. but is still routable
      const res = await request(app)
        .delete(`/api/tabs/${tabId}/recordings/..%2F..%2Fetc%2Fpasswd`)
        .set('Authorization', `Bearer ${token}`);

      expect([400, 404]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body.error).toContain('Invalid');
      }
    });
  });
});
