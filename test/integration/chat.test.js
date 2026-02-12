'use strict';

const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestApp } = require('../helpers/test-app');
const request = require('supertest');

describe('Chat Routes', () => {
  let ctx, app, token, roomId, tabId;

  beforeAll(async () => {
    ctx = await createMockContext();
    roomId = 'chattest1';
    const hashedPw = await require('../../lib/helpers').hashPassword('testpass123');
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'Chat Test Room',
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
    app = createTestApp(require('../../routes/chat'), ctx.routeCtx);
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  beforeEach(() => {
    ctx.clearBroadcasts();
  });

  describe('GET /api/chat', () => {
    it('returns empty array initially for global scope', async () => {
      const res = await request(app)
        .get('/api/chat')
        .query({ scope: 'global' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('returns empty array initially for tab scope', async () => {
      const res = await request(app)
        .get('/api/chat')
        .query({ scope: 'tab', tabId })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('requires scope parameter', async () => {
      const res = await request(app)
        .get('/api/chat')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('scope must be');
    });

    it('requires tabId for tab scope', async () => {
      const res = await request(app)
        .get('/api/chat')
        .query({ scope: 'tab' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('tabId is required');
    });

    it('returns 404 for non-existent tab', async () => {
      const res = await request(app)
        .get('/api/chat')
        .query({ scope: 'tab', tabId: 'deadbeef' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Tab not found');
    });
  });

  describe('POST /api/chat', () => {
    it('creates message with correct fields', async () => {
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: 'Hello team!' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.entry).toMatchObject({
        text: 'Hello team!',
        user: 'tester'
      });
      expect(res.body.entry.id).toMatch(/^[a-f0-9]{16}$/);
      expect(res.body.entry.timestamp).toBeTruthy();
    });

    it('creates message for tab scope', async () => {
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Tab-scoped message' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.entry.text).toBe('Tab-scoped message');

      // Verify it's persisted
      const getRes = await request(app)
        .get('/api/chat')
        .query({ scope: 'tab', tabId })
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.body.some(m => m.text === 'Tab-scoped message')).toBe(true);
    });

    it('broadcasts chat-message event', async () => {
      await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: 'Broadcast test' });

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0]).toMatchObject({
        roomId,
        event: {
          type: 'chat-message',
          scope: 'global'
        }
      });
      expect(ctx.broadcasts[0].event.entry.text).toBe('Broadcast test');
    });

    it('broadcasts tab-scoped chat-message with tabId', async () => {
      await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'Tab broadcast test' });

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event).toMatchObject({
        type: 'chat-message',
        scope: 'tab',
        tabId
      });
    });

    it('rejects empty text', async () => {
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('text is required');
    });

    it('rejects missing text', async () => {
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('text is required');
    });

    it('rejects text exceeding MAX_CHAT_MESSAGE_LENGTH', async () => {
      const longText = 'a'.repeat(ctx.routeCtx.LIMITS.MAX_CHAT_MESSAGE_LENGTH + 1);
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: longText });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('too long');
    });

    it('evicts oldest message at MAX_CHAT_MESSAGES', async () => {
      // Override limit for this test
      const original = ctx.routeCtx.LIMITS.MAX_CHAT_MESSAGES;
      ctx.routeCtx.LIMITS.MAX_CHAT_MESSAGES = 3;

      // Use a unique tab to avoid interference from other tests
      const evictTabId = 'e1e2e3e4';
      await ctx.storage.writeRoomTabs(roomId, {
        tabs: [
          { id: tabId, name: 'Target1', activeNoteId: null, variables: {}, commandHistory: [], status: null, scope: {} },
          { id: evictTabId, name: 'EvictTest', activeNoteId: null, variables: {}, commandHistory: [], status: null, scope: {} }
        ]
      });

      // Send 3 messages (fills to cap)
      for (let i = 1; i <= 3; i++) {
        await request(app)
          .post('/api/chat')
          .set('Authorization', `Bearer ${token}`)
          .send({ scope: 'tab', tabId: evictTabId, text: `msg${i}` });
      }

      // Send a 4th — should evict the 1st
      await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId: evictTabId, text: 'msg4' });

      const getRes = await request(app)
        .get('/api/chat')
        .query({ scope: 'tab', tabId: evictTabId })
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.body.length).toBe(3);
      expect(getRes.body[0].text).toBe('msg2');
      expect(getRes.body[1].text).toBe('msg3');
      expect(getRes.body[2].text).toBe('msg4');

      // Restore
      ctx.routeCtx.LIMITS.MAX_CHAT_MESSAGES = original;
    });

    it('requires scope parameter', async () => {
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'No scope' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('scope must be');
    });

    it('returns 404 for non-existent tab', async () => {
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId: 'deadbeef', text: 'Gone tab' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Tab not found');
    });
  });

  describe('DELETE /api/chat', () => {
    it('clears global chat messages', async () => {
      // Post a few messages first
      await request(app).post('/api/chat').set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: 'msg1' });
      await request(app).post('/api/chat').set('Authorization', `Bearer ${token}`)
        .send({ scope: 'global', text: 'msg2' });

      const res = await request(app).delete('/api/chat')
        .query({ scope: 'global' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify messages are gone
      const getRes = await request(app).get('/api/chat')
        .query({ scope: 'global' })
        .set('Authorization', `Bearer ${token}`);
      expect(getRes.body).toEqual([]);
    });

    it('clears tab-scoped chat messages', async () => {
      await request(app).post('/api/chat').set('Authorization', `Bearer ${token}`)
        .send({ scope: 'tab', tabId, text: 'tab msg' });

      await request(app).delete('/api/chat')
        .query({ scope: 'tab', tabId })
        .set('Authorization', `Bearer ${token}`);

      const getRes = await request(app).get('/api/chat')
        .query({ scope: 'tab', tabId })
        .set('Authorization', `Bearer ${token}`);
      expect(getRes.body).toEqual([]);
    });

    it('broadcasts chat-cleared event', async () => {
      ctx.clearBroadcasts();
      await request(app).delete('/api/chat')
        .query({ scope: 'global' })
        .set('Authorization', `Bearer ${token}`);

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('chat-cleared');
    });

    it('requires scope parameter', async () => {
      const res = await request(app).delete('/api/chat')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('requires auth', async () => {
      const res = await request(app).delete('/api/chat').query({ scope: 'global' });
      expect(res.status).toBe(401);
    });
  });

  describe('Authentication', () => {
    it('returns 401 without auth token', async () => {
      const res = await request(app)
        .get('/api/chat')
        .query({ scope: 'global' });

      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid auth token', async () => {
      const res = await request(app)
        .get('/api/chat')
        .query({ scope: 'global' })
        .set('Authorization', 'Bearer invalidtoken');

      expect(res.status).toBe(401);
    });
  });
});
