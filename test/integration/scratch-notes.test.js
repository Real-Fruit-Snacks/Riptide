'use strict';

const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestApp } = require('../helpers/test-app');
const request = require('supertest');

describe('Scratch Notes Routes', () => {
  let ctx, app, token, roomId, tabId;

  beforeAll(async () => {
    ctx = await createMockContext();
    roomId = 'scratchtest1';
    const hashedPw = await require('../../lib/helpers').hashPassword('testpass123');
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'Scratch Test Room',
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
    app = createTestApp(require('../../routes/scratch-notes'), ctx.routeCtx);
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  beforeEach(() => {
    ctx.clearBroadcasts();
  });

  describe('GET /api/scratch-notes', () => {
    it('returns tab-scoped notes', async () => {
      // Create a tab note
      await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Tab note content' });

      const res = await request(app)
        .get('/api/scratch-notes')
        .query({ scope: 'tab', tabId })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].text).toBe('Tab note content');
    });

    it('returns global notes', async () => {
      // Create a global note
      await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: 'Global note content' });

      const res = await request(app)
        .get('/api/scratch-notes')
        .query({ scope: 'global' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].text).toBe('Global note content');
    });

    it('requires scope parameter', async () => {
      const res = await request(app)
        .get('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('scope must be');
    });

    it('requires tabId for tab scope', async () => {
      const res = await request(app)
        .get('/api/scratch-notes')
        .query({ scope: 'tab' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('tabId is required');
    });

    it('returns 404 for non-existent tab', async () => {
      const res = await request(app)
        .get('/api/scratch-notes')
        .query({ scope: 'tab', tabId: 'deadbeef' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Tab not found');
    });
  });

  describe('POST /api/scratch-notes', () => {
    it('creates scratch note with valid content', async () => {
      const res = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Important finding here' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.entry).toMatchObject({
        text: 'Important finding here',
        user: 'tester',
        severity: null
      });
      expect(res.body.entry.id).toMatch(/^[a-f0-9]{8,16}$/);
      expect(res.body.entry.timestamp).toBeTruthy();
    });

    it('broadcasts scratch-note-created event', async () => {
      await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: 'Broadcast test' });

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0]).toMatchObject({
        roomId,
        event: {
          type: 'scratch-note-created',
          scope: 'global'
        }
      });
      expect(ctx.broadcasts[0].event.entry.text).toBe('Broadcast test');
    });

    it('returns 400 when cap of 500 notes is exceeded', async () => {
      // Create 500 notes (reaching limit)
      for (let i = 0; i < ctx.routeCtx.LIMITS.MAX_SCRATCH_NOTES; i++) {
        await request(app)
          .post('/api/scratch-notes')
          .set('Authorization', `Bearer ${token}`)
          .send({ scope: 'global', text: `Note ${i}` });
      }

      // Try to create one more
      const res = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: 'Overflow note' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Maximum scratch notes limit');
      expect(res.body.error).toContain('500');
    });

    it('requires text field', async () => {
      const res = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('text is required');
    });

    it('rejects empty text', async () => {
      const res = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('text is required');
    });

    it('rejects text over max length', async () => {
      const longText = 'a'.repeat(ctx.routeCtx.LIMITS.MAX_SCRATCH_NOTE_LENGTH + 1);
      const res = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: longText });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('too long');
    });

    it('creates note with severity', async () => {
      const res = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Critical issue', severity: 'critical' });

      expect(res.status).toBe(200);
      expect(res.body.entry.severity).toBe('critical');
    });
  });

  describe('PATCH /api/scratch-notes/:id/severity', () => {
    it('cycles severity on scratch note', async () => {
      // Create a note
      const createRes = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Severity test note' });

      const noteId = createRes.body.entry.id;
      ctx.clearBroadcasts();

      // Update severity
      const res = await request(app)
        .patch(`/api/scratch-notes/${noteId}/severity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, severity: 'high' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event).toMatchObject({
        type: 'scratch-note-severity-changed',
        scope: 'tab',
        tabId,
        noteId,
        severity: 'high'
      });
    });

    it('broadcasts scratch-note-severity-changed event', async () => {
      const createRes = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Severity broadcast test' });

      const noteId = createRes.body.entry.id;
      ctx.clearBroadcasts();

      await request(app)
        .patch(`/api/scratch-notes/${noteId}/severity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, severity: 'medium' });

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('scratch-note-severity-changed');
    });

    it('returns 404 for non-existent note', async () => {
      const res = await request(app)
        .patch('/api/scratch-notes/deadbeef/severity')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', severity: 'low' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('rejects invalid severity value', async () => {
      const createRes = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Test' });

      const noteId = createRes.body.entry.id;

      const res = await request(app)
        .patch(`/api/scratch-notes/${noteId}/severity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, severity: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid severity');
    });
  });

  describe('PUT /api/scratch-notes/:id', () => {
    it('updates scratch note text', async () => {
      const createRes = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Original text' });

      const noteId = createRes.body.entry.id;
      ctx.clearBroadcasts();

      const updateRes = await request(app)
        .put(`/api/scratch-notes/${noteId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Updated text' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.ok).toBe(true);
      expect(updateRes.body.entry.text).toBe('Updated text');

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('scratch-note-updated');
    });

    it('broadcasts scratch-note-updated event', async () => {
      const createRes = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Initial' });

      const noteId = createRes.body.entry.id;
      ctx.clearBroadcasts();

      await request(app)
        .put(`/api/scratch-notes/${noteId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Modified' });

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event).toMatchObject({
        type: 'scratch-note-updated',
        scope: 'tab',
        tabId
      });
    });

    it('returns 404 for non-existent note', async () => {
      const res = await request(app)
        .put('/api/scratch-notes/cafebabe')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: 'Update attempt' });

      expect(res.status).toBe(404);
    });

    it('requires text field', async () => {
      const createRes = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Test' });

      const noteId = createRes.body.entry.id;

      const res = await request(app)
        .put(`/api/scratch-notes/${noteId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('text is required');
    });
  });

  describe('DELETE /api/scratch-notes/:id', () => {
    it('deletes scratch note', async () => {
      const createRes = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'To be deleted' });

      const noteId = createRes.body.entry.id;
      ctx.clearBroadcasts();

      const deleteRes = await request(app)
        .delete(`/api/scratch-notes/${noteId}`)
        .query({ scope: 'tab', tabId })
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.ok).toBe(true);

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event).toMatchObject({
        type: 'scratch-note-deleted',
        scope: 'tab',
        tabId,
        noteId
      });

      // Verify it's gone
      const getRes = await request(app)
        .get('/api/scratch-notes')
        .query({ scope: 'tab', tabId })
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.body.find(n => n.id === noteId)).toBeUndefined();
    });

    it('broadcasts scratch-note-deleted event', async () => {
      const createRes = await request(app)
        .post('/api/scratch-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Delete test' });

      const noteId = createRes.body.entry.id;
      ctx.clearBroadcasts();

      await request(app)
        .delete(`/api/scratch-notes/${noteId}`)
        .query({ scope: 'tab', tabId })
        .set('Authorization', `Bearer ${token}`);

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('scratch-note-deleted');
    });

    it('returns 404 for non-existent note', async () => {
      const res = await request(app)
        .delete('/api/scratch-notes/baadf00d')
        .query({ scope: 'global' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('requires scope parameter', async () => {
      const res = await request(app)
        .delete('/api/scratch-notes/12345678')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('scope must be');
    });
  });
});
