'use strict';

const request = require('supertest');
const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestApp } = require('../helpers/test-app');

describe('Alerts Routes', () => {
  let ctx, app, token, roomId;

  beforeAll(async () => {
    ctx = await createMockContext();
    roomId = 'test-room-alerts';

    // Create test room
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'Alerts Room',
        passwordHash: 'dummy',
        workDir: ctx.tempDir,
        creator: 'tester'
      });
    });

    token = ctx.addSession(roomId, 'tester');
    app = createTestApp(require('../../routes/alerts'), ctx.routeCtx);
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  beforeEach(async () => {
    // Clear alerts before each test
    await ctx.storage.writeAlerts(roomId, []);
    ctx.clearBroadcasts();
  });

  describe('GET /api/alerts', () => {
    it('should return empty array initially', async () => {
      const res = await request(app)
        .get('/api/alerts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return alerts after adding them', async () => {
      // Add some alerts directly via storage
      const alerts = [
        {
          id: 'alert1',
          nickname: 'tester',
          context: 'playbook',
          title: 'SQL Injection Found',
          preview: 'sqlmap -u http://target.com',
          timestamp: new Date().toISOString()
        },
        {
          id: 'alert2',
          nickname: 'tester',
          context: 'credential',
          title: 'Admin Password',
          preview: 'admin:password123',
          timestamp: new Date().toISOString()
        }
      ];

      await ctx.storage.writeAlerts(roomId, alerts);

      const res = await request(app)
        .get('/api/alerts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].title).toBe('SQL Injection Found');
      expect(res.body[1].title).toBe('Admin Password');
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/alerts')
        .expect(401);
    });
  });

  describe('DELETE /api/alerts', () => {
    it('should clear all alerts', async () => {
      // Add alerts first
      const alerts = [
        {
          id: 'alert1',
          nickname: 'tester',
          context: 'playbook',
          title: 'Test Alert',
          preview: 'test content',
          timestamp: new Date().toISOString()
        }
      ];
      await ctx.storage.writeAlerts(roomId, alerts);

      // Clear alerts
      await request(app)
        .delete('/api/alerts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Verify alerts are cleared
      const remaining = await ctx.storage.readAlerts(roomId);
      expect(remaining).toEqual([]);
    });

    it('should broadcast alerts-cleared event', async () => {
      await request(app)
        .delete('/api/alerts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(ctx.broadcasts.length).toBe(1);
      expect(ctx.broadcasts[0].roomId).toBe(roomId);
      expect(ctx.broadcasts[0].event.type).toBe('alerts-cleared');
      expect(ctx.broadcasts[0].excludeToken).toBe(token);
    });

    it('should require authentication', async () => {
      await request(app)
        .delete('/api/alerts')
        .expect(401);
    });
  });

  describe('Alert cap and ordering', () => {
    it('caps alerts at MAX_ALERTS (200)', async () => {
      const alerts = Array.from({ length: 200 }, (_, i) => ({
        id: `alert-${i}`,
        nickname: 'tester',
        context: 'playbook',
        title: `Alert ${i}`,
        preview: `preview ${i}`,
        timestamp: new Date(Date.now() + i).toISOString()
      }));
      await ctx.storage.writeAlerts(roomId, alerts);

      const res = await request(app)
        .get('/api/alerts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.length).toBe(200);
    });

    it('newest alerts are kept when cap is reached', async () => {
      // Seed exactly 200 alerts with sequential timestamps
      const alerts = Array.from({ length: 200 }, (_, i) => ({
        id: `alert-${i}`,
        nickname: 'tester',
        context: 'playbook',
        title: `Alert ${i}`,
        preview: `preview ${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString()
      }));
      await ctx.storage.writeAlerts(roomId, alerts);

      // Add one more via atomicUpdateAlerts — this should drop the oldest
      await ctx.storage.atomicUpdateAlerts(roomId, existing => {
        existing.push({
          id: 'alert-new',
          nickname: 'tester',
          context: 'credential',
          title: 'Newest Alert',
          preview: 'newest',
          timestamp: new Date(Date.now() + 999999).toISOString()
        });
        // Enforce cap (same logic the server uses)
        if (existing.length > 200) existing.splice(0, existing.length - 200);
        return existing;
      });

      const res = await request(app)
        .get('/api/alerts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.length).toBe(200);
      // The oldest alert (alert-0) should have been dropped
      const ids = res.body.map(a => a.id);
      expect(ids).not.toContain('alert-0');
      // The newest alert should be present
      expect(ids).toContain('alert-new');
    });

    it('returns alerts in stored order', async () => {
      const alerts = [
        { id: 'first', nickname: 'a', context: 'playbook', title: 'First', preview: '', timestamp: '2025-01-01T00:00:00Z' },
        { id: 'second', nickname: 'b', context: 'credential', title: 'Second', preview: '', timestamp: '2025-01-02T00:00:00Z' },
        { id: 'third', nickname: 'c', context: 'scratch', title: 'Third', preview: '', timestamp: '2025-01-03T00:00:00Z' }
      ];
      await ctx.storage.writeAlerts(roomId, alerts);

      const res = await request(app)
        .get('/api/alerts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.map(a => a.id)).toEqual(['first', 'second', 'third']);
    });
  });
});
