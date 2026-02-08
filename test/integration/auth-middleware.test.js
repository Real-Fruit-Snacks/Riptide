'use strict';

const request = require('supertest');
const express = require('express');
const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createExpiredSession } = require('../helpers/auth-helper');

describe('Auth Middleware', () => {
  let ctx, app, roomId, tabId;

  beforeAll(async () => {
    ctx = await createMockContext();
    roomId = 'test-room-auth';
    tabId = 'def45678';

    // Create test room
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'Auth Room',
        passwordHash: 'dummy',
        workDir: ctx.tempDir,
        creator: 'tester'
      });
    });

    // Create test tab - initialize tabs.json first
    await ctx.storage.writeRoomTabs(roomId, { tabs: [] });
    await ctx.storage.atomicUpdateRoomTabs(roomId, tabs => {
      tabs.tabs.push({
        id: tabId,
        name: 'AuthTab',
        variables: {},
        history: []
      });
    });

    // Create minimal test app with middleware
    app = express();
    app.use(express.json());

    // Test endpoint for requireRoom
    app.get('/api/test', ctx.routeCtx.requireRoom, (req, res) => {
      res.json({ roomId: req.roomId, nickname: req.nickname });
    });

    // Test endpoint for validateTabId
    app.get('/api/tabs/:tabId/test', ctx.routeCtx.requireRoom, ctx.routeCtx.validateTabId, (req, res) => {
      res.json({ tabId: req.params.tabId, roomId: req.roomId });
    });

    // Test endpoint for validateNoteId
    app.get('/api/tabs/:tabId/notes/:noteId/test',
      ctx.routeCtx.requireRoom,
      ctx.routeCtx.validateTabId,
      ctx.routeCtx.validateNoteId,
      (req, res) => {
        res.json({ noteId: req.params.noteId, notePath: req.notePath });
      }
    );
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  describe('requireRoom middleware', () => {
    it('should pass with valid Bearer token', async () => {
      const token = ctx.addSession(roomId, 'alice');

      const res = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.roomId).toBe(roomId);
      expect(res.body.nickname).toBe('alice');
    });

    it('should return 401 when Authorization header is missing', async () => {
      await request(app)
        .get('/api/test')
        .expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(app)
        .get('/api/test')
        .set('Authorization', 'Bearer invalid-token-12345')
        .expect(401);
    });

    it('should return 401 with expired session', async () => {
      const expiredToken = createExpiredSession(
        ctx.sessions,
        ctx.routeCtx.roomSessionTokens,
        roomId,
        'expired-user'
      );

      const res = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(res.body.error).toBe('Session expired');

      // Verify session was deleted
      expect(ctx.sessions.has(expiredToken)).toBe(false);
    });

    it('should handle malformed Authorization header', async () => {
      await request(app)
        .get('/api/test')
        .set('Authorization', 'InvalidFormat')
        .expect(401);
    });

    it('should handle empty Bearer token', async () => {
      await request(app)
        .get('/api/test')
        .set('Authorization', 'Bearer ')
        .expect(401);
    });

    it('should set req.roomId, req.nickname, and req.token', async () => {
      const token = ctx.addSession(roomId, 'bob');

      const res = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.roomId).toBe(roomId);
      expect(res.body.nickname).toBe('bob');
    });
  });

  describe('validateTabId middleware', () => {
    it('should pass with valid tab ID that exists', async () => {
      const token = ctx.addSession(roomId, 'alice');

      const res = await request(app)
        .get(`/api/tabs/${tabId}/test`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.tabId).toBe(tabId);
      expect(res.body.roomId).toBe(roomId);
    });

    it('should return 400 for invalid tab ID format (not 8 hex chars)', async () => {
      const token = ctx.addSession(roomId, 'alice');

      await request(app)
        .get('/api/tabs/invalid/test')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should return 400 for tab ID with wrong length', async () => {
      const token = ctx.addSession(roomId, 'alice');

      await request(app)
        .get('/api/tabs/abc123/test')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should return 400 for tab ID with non-hex characters', async () => {
      const token = ctx.addSession(roomId, 'alice');

      await request(app)
        .get('/api/tabs/ghij5678/test')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should return 404 for valid format but non-existent tab', async () => {
      const token = ctx.addSession(roomId, 'alice');

      await request(app)
        .get('/api/tabs/ffffffff/test')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('validateNoteId middleware', () => {
    it('should pass with valid alphanumeric+dash+underscore note ID', async () => {
      const token = ctx.addSession(roomId, 'alice');

      const res = await request(app)
        .get(`/api/tabs/${tabId}/notes/valid-note_123/test`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.noteId).toBe('valid-note_123');
      expect(res.body.notePath).toBeTruthy();
    });

    it('should reject note ID with special characters', async () => {
      const token = ctx.addSession(roomId, 'alice');

      await request(app)
        .get(`/api/tabs/${tabId}/notes/invalid@note/test`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should reject note ID containing special characters', async () => {
      const token = ctx.addSession(roomId, 'alice');

      // Note ID with @ is rejected by regex
      await request(app)
        .get(`/api/tabs/${tabId}/notes/test@note/test`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should reject note ID containing forward slash', async () => {
      const token = ctx.addSession(roomId, 'alice');

      // URL-encoded slash in note ID
      await request(app)
        .get(`/api/tabs/${tabId}/notes/test%2Fnote/test`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should reject note ID containing dots', async () => {
      const token = ctx.addSession(roomId, 'alice');

      // Note ID with dots - rejected by regex (only allows [a-zA-Z0-9_-])
      await request(app)
        .get(`/api/tabs/${tabId}/notes/test.note/test`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });
});
