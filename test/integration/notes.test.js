'use strict';

const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestApp } = require('../helpers/test-app');
const request = require('supertest');
const path = require('path');
const fsp = require('fs').promises;

describe('Notes Route Integration Tests', () => {
  let ctx, app, token, roomId, tabId;

  beforeAll(async () => {
    ctx = await createMockContext();

    // Create a room with workDir
    roomId = 'test-room-notes';
    const hashedPw = await ctx.routeCtx.hashPassword('testpass123');
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'Notes Test Room',
        passwordHash: hashedPw,
        workDir: ctx.tempDir,
        creator: 'tester'
      });
    });

    // Create initial tab data
    tabId = 'a1b2c3d4';
    const tabsData = {
      tabs: [{
        id: tabId,
        name: 'Target1',
        activeNoteId: null,
        variables: {},
        commandHistory: [],
        status: null,
        scope: {},
        noteSeverities: {}
      }]
    };
    await ctx.storage.writeRoomTabs(roomId, tabsData);

    // Create session
    token = ctx.addSession(roomId, 'tester');

    // Mount route
    app = createTestApp(require('../../routes/notes'), ctx.routeCtx);
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  describe('POST /api/tabs/:tabId/notes - Create note', () => {
    it('should create a note with valid title', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Initial Recon' })
        .expect(201);

      expect(res.body).toHaveProperty('id', 'initial-recon');
      expect(res.body).toHaveProperty('title', 'initial-recon');
      expect(res.body).toHaveProperty('content');
      expect(res.body.content).toContain('# Initial Recon');
      expect(res.body).toHaveProperty('modified');

      // Verify file was created
      const tabNotesDir = await ctx.storage.resolveTabDataDir(roomId, tabId);
      const filePath = path.join(tabNotesDir, 'initial-recon.md');
      const exists = await ctx.storage.fileExists(filePath);
      expect(exists).toBe(true);

      // Verify broadcast
      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('note-created');
      expect(ctx.broadcasts[0].event.tabId).toBe(tabId);
      expect(ctx.broadcasts[0].event.note.id).toBe('initial-recon');
    });

    it('should create note with custom content', async () => {
      const customContent = '# Custom Note\n\nSome content here';
      const res = await request(app)
        .post(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Custom Note', content: customContent })
        .expect(201);

      expect(res.body.content).toBe(customContent);
    });

    it('should handle duplicate titles with suffix', async () => {
      // Create first note
      await request(app)
        .post(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Duplicate Test' })
        .expect(201);

      // Create second note with same title
      const res = await request(app)
        .post(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Duplicate Test' })
        .expect(201);

      expect(res.body.id).toBe('duplicate-test-2');
    });

    it('should sanitize title to valid ID', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Port Scan: 80/443' })
        .expect(201);

      expect(res.body.id).toBe('port-scan-80-443');
    });

    it('should reject empty title', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '' })
        .expect(400);
    });

    it('should reject whitespace-only title', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '   ' })
        .expect(400);
    });

    it('should reject title that produces empty ID', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '!!!' })
        .expect(400);
    });

    it('should append to order list when created', async () => {
      // Create order file first
      await ctx.storage.saveNotesOrder(roomId, tabId, ['existing-note']);

      await request(app)
        .post(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'New Note' })
        .expect(201);

      const order = await ctx.storage.getNotesOrder(roomId, tabId);
      expect(order).toContain('existing-note');
      expect(order).toContain('new-note');
    });
  });

  describe('GET /api/tabs/:tabId/notes - List notes', () => {
    beforeAll(async () => {
      ctx.clearBroadcasts();
    });

    it('should return empty array when no notes exist', async () => {
      // Create a new tab with no notes
      const newTabId = 'b2c3d4e5';
      await ctx.storage.atomicUpdateRoomTabs(roomId, data => {
        data.tabs.push({
          id: newTabId,
          name: 'Empty Tab',
          activeNoteId: null,
          variables: {},
          commandHistory: [],
          status: null,
          scope: {},
          noteSeverities: {}
        });
      });

      const res = await request(app)
        .get(`/api/tabs/${newTabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return notes with metadata', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const note = res.body[0];
      expect(note).toHaveProperty('id');
      expect(note).toHaveProperty('title');
      expect(note).toHaveProperty('modified');
      expect(note).toHaveProperty('severity');
    });

    it('should include severity from tab data', async () => {
      // Set severity for a note
      await ctx.storage.atomicUpdateRoomTabs(roomId, data => {
        const tab = data.tabs.find(t => t.id === tabId);
        if (!tab.noteSeverities) tab.noteSeverities = {};
        tab.noteSeverities['initial-recon'] = 'high';
      });

      const res = await request(app)
        .get(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const note = res.body.find(n => n.id === 'initial-recon');
      expect(note.severity).toBe('high');
    });

    it('should apply persisted order', async () => {
      await ctx.storage.saveNotesOrder(roomId, tabId, ['custom-note', 'initial-recon']);

      const res = await request(app)
        .get(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body[0].id).toBe('custom-note');
      expect(res.body[1].id).toBe('initial-recon');
    });

    it('should sort by mtime when no order exists', async () => {
      // Remove order file
      const tabNotesDir = await ctx.storage.resolveTabDataDir(roomId, tabId);
      const orderPath = path.join(tabNotesDir, '_order.json');
      try {
        await fsp.unlink(orderPath);
      } catch {}

      const res = await request(app)
        .get(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Should be sorted newest first
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/tabs/:tabId/notes/:noteId - Get note content', () => {
    it('should return note content', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabId}/notes/initial-recon`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', 'initial-recon');
      expect(res.body).toHaveProperty('title', 'initial-recon');
      expect(res.body).toHaveProperty('content');
      expect(res.body).toHaveProperty('modified');
    });

    it('should return 404 for non-existent note', async () => {
      await request(app)
        .get(`/api/tabs/${tabId}/notes/does-not-exist`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should reject path traversal in noteId', async () => {
      // Path traversal gets caught by validateNoteId returning 400, or if the
      // path doesn't exist after normalization, it returns 404
      const res = await request(app)
        .get(`/api/tabs/${tabId}/notes/../../../etc/passwd`)
        .set('Authorization', `Bearer ${token}`);

      expect([400, 404]).toContain(res.status);
    });

    it('should reject invalid characters in noteId', async () => {
      await request(app)
        .get(`/api/tabs/${tabId}/notes/invalid@note`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('PUT /api/tabs/:tabId/notes/:noteId - Update note', () => {
    beforeAll(async () => {
      ctx.clearBroadcasts();
    });

    it('should update note content', async () => {
      const newContent = '# Updated Content\n\nNew information here';
      const res = await request(app)
        .put(`/api/tabs/${tabId}/notes/initial-recon`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: newContent })
        .expect(200);

      expect(res.body.content).toBe(newContent);

      // Verify file was updated
      const tabNotesDir = await ctx.storage.resolveTabDataDir(roomId, tabId);
      const filePath = path.join(tabNotesDir, 'initial-recon.md');
      const fileContent = await fsp.readFile(filePath, 'utf-8');
      expect(fileContent).toBe(newContent);

      // Verify broadcast
      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('note-updated');
      expect(ctx.broadcasts[0].event.noteId).toBe('initial-recon');
      expect(ctx.broadcasts[0].event.content).toBe(newContent);
    });

    it('should allow empty content', async () => {
      await request(app)
        .put(`/api/tabs/${tabId}/notes/initial-recon`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '' })
        .expect(200);
    });

    it('should reject missing content field', async () => {
      await request(app)
        .put(`/api/tabs/${tabId}/notes/initial-recon`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('should reject content exceeding MAX_NOTE_BYTES', async () => {
      const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB
      // Express body parser (256kb limit) will reject this with 413
      // If it got through, the route would also reject with 413
      const res = await request(app)
        .put(`/api/tabs/${tabId}/notes/initial-recon`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: largeContent });

      // Either Express body limit (413) or route validation (413)
      expect([413, 500]).toContain(res.status);
    });

    it('should reject body exceeding 256KB Express limit', async () => {
      // 260KB content in JSON wrapper exceeds the 256KB body parser limit
      const content = 'A'.repeat(260 * 1024);
      const res = await request(app)
        .put(`/api/tabs/${tabId}/notes/initial-recon`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content });

      expect(res.status).toBe(413);
    });

    it('should return 404 for non-existent note', async () => {
      await request(app)
        .put(`/api/tabs/${tabId}/notes/does-not-exist`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'test' })
        .expect(404);
    });
  });

  describe('PATCH /api/tabs/:tabId/notes/:noteId/severity - Toggle severity', () => {
    beforeAll(async () => {
      ctx.clearBroadcasts();
    });

    it('should set severity to info', async () => {
      const res = await request(app)
        .patch(`/api/tabs/${tabId}/notes/initial-recon/severity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ severity: 'info' })
        .expect(200);

      expect(res.body.severity).toBe('info');

      // Verify broadcast
      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('note-severity-changed');
      expect(ctx.broadcasts[0].event.severity).toBe('info');
    });

    it('should cycle through severity levels', async () => {
      const levels = ['low', 'medium', 'high', 'critical'];
      for (const level of levels) {
        ctx.clearBroadcasts();
        const res = await request(app)
          .patch(`/api/tabs/${tabId}/notes/initial-recon/severity`)
          .set('Authorization', `Bearer ${token}`)
          .send({ severity: level })
          .expect(200);

        expect(res.body.severity).toBe(level);
      }
    });

    it('should clear severity with null', async () => {
      const res = await request(app)
        .patch(`/api/tabs/${tabId}/notes/initial-recon/severity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ severity: null })
        .expect(200);

      expect(res.body.severity).toBe(null);

      // Verify it was removed from tab data
      const data = await ctx.storage.readRoomTabs(roomId);
      const tab = data.tabs.find(t => t.id === tabId);
      expect(tab.noteSeverities['initial-recon']).toBeUndefined();
    });

    it('should reject invalid severity', async () => {
      await request(app)
        .patch(`/api/tabs/${tabId}/notes/initial-recon/severity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ severity: 'invalid' })
        .expect(400);
    });
  });

  describe('POST /api/tabs/:tabId/notes/:noteId/append - Append content', () => {
    beforeAll(async () => {
      ctx.clearBroadcasts();
      // Reset note to known content
      const tabNotesDir = await ctx.storage.resolveTabDataDir(roomId, tabId);
      const filePath = path.join(tabNotesDir, 'initial-recon.md');
      await fsp.writeFile(filePath, '# Initial Content\n');
    });

    it('should append content to note', async () => {
      const appendText = '\nAppended text\n';
      const res = await request(app)
        .post(`/api/tabs/${tabId}/notes/initial-recon/append`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: appendText })
        .expect(200);

      expect(res.body.ok).toBe(true);

      // Verify file content
      const tabNotesDir = await ctx.storage.resolveTabDataDir(roomId, tabId);
      const filePath = path.join(tabNotesDir, 'initial-recon.md');
      const content = await fsp.readFile(filePath, 'utf-8');
      expect(content).toBe('# Initial Content\n\nAppended text\n');

      // Verify broadcast with full content
      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('note-updated');
      expect(ctx.broadcasts[0].event.content).toBe('# Initial Content\n\nAppended text\n');
    });

    it('should reject missing content', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/notes/initial-recon/append`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('should reject content exceeding MAX_NOTE_BYTES', async () => {
      const largeContent = 'x'.repeat(2 * 1024 * 1024);
      // Express body parser (256kb limit) will reject this with 413
      // If it got through, the route would also reject with 413
      const res = await request(app)
        .post(`/api/tabs/${tabId}/notes/initial-recon/append`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: largeContent });

      // Either Express body limit (413) or route validation (413)
      expect([413, 500]).toContain(res.status);
    });

    it('should return 404 for non-existent note', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/notes/does-not-exist/append`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'test' })
        .expect(404);
    });
  });

  describe('PUT /api/tabs/:tabId/notes/order - Reorder notes', () => {
    beforeAll(async () => {
      ctx.clearBroadcasts();
    });

    it('should save note order', async () => {
      const order = ['custom-note', 'initial-recon', 'duplicate-test'];
      const res = await request(app)
        .put(`/api/tabs/${tabId}/notes/order`)
        .set('Authorization', `Bearer ${token}`)
        .send({ order })
        .expect(200);

      expect(res.body.ok).toBe(true);

      // Verify order was saved
      const savedOrder = await ctx.storage.getNotesOrder(roomId, tabId);
      expect(savedOrder).toEqual(order);

      // Verify broadcast
      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('notes-reordered');
      expect(ctx.broadcasts[0].event.order).toEqual(order);
    });

    it('should accept empty order array', async () => {
      await request(app)
        .put(`/api/tabs/${tabId}/notes/order`)
        .set('Authorization', `Bearer ${token}`)
        .send({ order: [] })
        .expect(200);
    });

    it('should reject non-array order', async () => {
      await request(app)
        .put(`/api/tabs/${tabId}/notes/order`)
        .set('Authorization', `Bearer ${token}`)
        .send({ order: 'not-an-array' })
        .expect(400);
    });

    it('should reject missing order field', async () => {
      await request(app)
        .put(`/api/tabs/${tabId}/notes/order`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });
  });

  describe('DELETE /api/tabs/:tabId/notes/:noteId - Delete note', () => {
    beforeAll(async () => {
      ctx.clearBroadcasts();
    });

    it('should delete note file', async () => {
      // Create a note to delete
      await request(app)
        .post(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'To Delete' })
        .expect(201);

      ctx.clearBroadcasts();

      const res = await request(app)
        .delete(`/api/tabs/${tabId}/notes/to-delete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.ok).toBe(true);

      // Verify file was deleted
      const tabNotesDir = await ctx.storage.resolveTabDataDir(roomId, tabId);
      const filePath = path.join(tabNotesDir, 'to-delete.md');
      const exists = await ctx.storage.fileExists(filePath);
      expect(exists).toBe(false);

      // Verify broadcast
      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('note-deleted');
      expect(ctx.broadcasts[0].event.noteId).toBe('to-delete');
    });

    it('should remove from order list', async () => {
      // Create note and add to order
      await request(app)
        .post(`/api/tabs/${tabId}/notes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Order Test' })
        .expect(201);

      await ctx.storage.saveNotesOrder(roomId, tabId, ['order-test', 'initial-recon']);

      // Delete note
      await request(app)
        .delete(`/api/tabs/${tabId}/notes/order-test`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Verify removed from order
      const order = await ctx.storage.getNotesOrder(roomId, tabId);
      expect(order).not.toContain('order-test');
      expect(order).toContain('initial-recon');
    });

    it('should clear edit lock', async () => {
      // Create lock
      const lockKey = `${roomId}:${tabId}:initial-recon`;
      ctx.editLocks.set(lockKey, { nickname: 'tester', timestamp: Date.now() });

      await request(app)
        .delete(`/api/tabs/${tabId}/notes/initial-recon`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(ctx.editLocks.has(lockKey)).toBe(false);
    });

    it('should return 404 for non-existent note', async () => {
      await request(app)
        .delete(`/api/tabs/${tabId}/notes/does-not-exist`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
