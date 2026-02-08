'use strict';

const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestApp } = require('../helpers/test-app');
const request = require('supertest');

describe('History Route Integration Tests', () => {
  let ctx, app, token, roomId, tabId;

  beforeAll(async () => {
    ctx = await createMockContext();

    // Create a room with workDir
    roomId = 'test-room-history';
    const hashedPw = await ctx.routeCtx.hashPassword('testpass123');
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'History Test Room',
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
        scope: {}
      }]
    };
    await ctx.storage.writeRoomTabs(roomId, tabsData);

    // Create session
    token = ctx.addSession(roomId, 'tester');

    // Mount route
    app = createTestApp(require('../../routes/history'), ctx.routeCtx);
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  describe('GET /api/tabs/:tabId/history - Get history', () => {
    it('should return empty array when no history exists', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return command history array', async () => {
      // Add some history
      await ctx.storage.atomicUpdateRoomTabs(roomId, data => {
        const tab = data.tabs.find(t => t.id === tabId);
        tab.commandHistory = [
          { id: 'cmd1', command: 'nmap 10.0.0.1', timestamp: '2024-01-01T00:00:00Z', user: 'tester' },
          { id: 'cmd2', command: 'ping 10.0.0.1', timestamp: '2024-01-01T00:01:00Z', user: 'tester' }
        ];
      });

      const res = await request(app)
        .get(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].command).toBe('nmap 10.0.0.1');
      expect(res.body[1].command).toBe('ping 10.0.0.1');
    });

    it('should return 404 for non-existent tab', async () => {
      await request(app)
        .get('/api/tabs/99999999/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('POST /api/tabs/:tabId/history - Add command', () => {
    beforeAll(async () => {
      ctx.clearBroadcasts();
      // Reset history
      await ctx.storage.atomicUpdateRoomTabs(roomId, data => {
        const tab = data.tabs.find(t => t.id === tabId);
        tab.commandHistory = [];
      });
    });

    it('should add command to history', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 'nmap -sV 10.0.0.1' })
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.entry).toHaveProperty('id');
      expect(res.body.entry.command).toBe('nmap -sV 10.0.0.1');
      expect(res.body.entry.user).toBe('tester');
      expect(res.body.entry).toHaveProperty('timestamp');

      // Verify broadcast
      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('command-logged');
      expect(ctx.broadcasts[0].event.tabId).toBe(tabId);
      expect(ctx.broadcasts[0].event.entry.command).toBe('nmap -sV 10.0.0.1');
    });

    it('should deduplicate consecutive duplicate commands', async () => {
      ctx.clearBroadcasts();

      // Add first command
      const res1 = await request(app)
        .post(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 'ls -la' })
        .expect(200);

      expect(res1.body.entry.command).toBe('ls -la');
      expect(ctx.broadcasts).toHaveLength(1);

      ctx.clearBroadcasts();

      // Add same command again (should be deduplicated)
      const res2 = await request(app)
        .post(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 'ls -la' })
        .expect(200);

      expect(res2.body.duplicate).toBe(true);
      expect(res2.body.entry.command).toBe('ls -la');
      // Should not broadcast duplicate
      expect(ctx.broadcasts).toHaveLength(0);

      // Verify history has only one entry for ls -la
      const data = await ctx.storage.readRoomTabs(roomId);
      const tab = data.tabs.find(t => t.id === tabId);
      const lsCommands = tab.commandHistory.filter(e => e.command === 'ls -la');
      expect(lsCommands).toHaveLength(1);
    });

    it('should allow same command if not consecutive', async () => {
      ctx.clearBroadcasts();

      // Add command 1
      await request(app)
        .post(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 'pwd' })
        .expect(200);

      // Add command 2 (different)
      await request(app)
        .post(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 'whoami' })
        .expect(200);

      ctx.clearBroadcasts();

      // Add command 1 again (should be allowed since not consecutive)
      const res = await request(app)
        .post(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 'pwd' })
        .expect(200);

      expect(res.body.duplicate).toBeUndefined();
      expect(ctx.broadcasts).toHaveLength(1);
    });

    it('should cap history at MAX_HISTORY_ENTRIES', async () => {
      // Clear history
      await ctx.storage.atomicUpdateRoomTabs(roomId, data => {
        const tab = data.tabs.find(t => t.id === tabId);
        tab.commandHistory = [];
      });

      // Add more than MAX_HISTORY_ENTRIES (100)
      for (let i = 0; i < 105; i++) {
        await request(app)
          .post(`/api/tabs/${tabId}/history`)
          .set('Authorization', `Bearer ${token}`)
          .send({ command: `command-${i}` })
          .expect(200);
      }

      // Verify capped at 100
      const data = await ctx.storage.readRoomTabs(roomId);
      const tab = data.tabs.find(t => t.id === tabId);
      expect(tab.commandHistory).toHaveLength(100);
      // Should keep most recent
      expect(tab.commandHistory[99].command).toBe('command-104');
    });

    it('should reject missing command', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('should reject command exceeding MAX_COMMAND_LENGTH', async () => {
      const longCommand = 'a'.repeat(60000);
      await request(app)
        .post(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: longCommand })
        .expect(400);
    });

    it('should reject non-string command', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 123 })
        .expect(400);
    });

    it('should return 404 for non-existent tab', async () => {
      await request(app)
        .post('/api/tabs/99999999/history')
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 'test' })
        .expect(404);
    });
  });

  describe('DELETE /api/tabs/:tabId/history - Clear history', () => {
    beforeAll(async () => {
      ctx.clearBroadcasts();
      // Add some history
      await ctx.storage.atomicUpdateRoomTabs(roomId, data => {
        const tab = data.tabs.find(t => t.id === tabId);
        tab.commandHistory = [
          { id: 'cmd1', command: 'test1', timestamp: '2024-01-01T00:00:00Z', user: 'tester' },
          { id: 'cmd2', command: 'test2', timestamp: '2024-01-01T00:01:00Z', user: 'tester' }
        ];
      });
    });

    it('should clear all history entries', async () => {
      const res = await request(app)
        .delete(`/api/tabs/${tabId}/history`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.ok).toBe(true);

      // Verify history cleared
      const data = await ctx.storage.readRoomTabs(roomId);
      const tab = data.tabs.find(t => t.id === tabId);
      expect(tab.commandHistory).toEqual([]);

      // Verify broadcast
      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('history-cleared');
      expect(ctx.broadcasts[0].event.tabId).toBe(tabId);
    });

    it('should return 404 for non-existent tab', async () => {
      await request(app)
        .delete('/api/tabs/99999999/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
