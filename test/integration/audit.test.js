'use strict';

const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestApp } = require('../helpers/test-app');
const request = require('supertest');

describe('Audit Route Integration Tests', () => {
  let ctx, app, token, roomId, tabId;

  beforeAll(async () => {
    ctx = await createMockContext();

    // Create a room with workDir
    roomId = 'test-room-audit';
    const hashedPw = await ctx.routeCtx.hashPassword('testpass123');
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'Audit Test Room',
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
        auditLog: []
      }]
    };
    await ctx.storage.writeRoomTabs(roomId, tabsData);

    // Create session
    token = ctx.addSession(roomId, 'tester');

    // Mount route
    app = createTestApp(require('../../routes/audit'), ctx.routeCtx);
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  describe('GET /api/tabs/:tabId/audit - Get audit log', () => {
    it('should return empty array when no audit log exists', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return audit log entries', async () => {
      // Add some audit entries
      await ctx.storage.atomicUpdateRoomTabs(roomId, data => {
        const tab = data.tabs.find(t => t.id === tabId);
        tab.auditLog = [
          {
            id: 'audit1',
            playbookTitle: 'Initial Recon',
            noteId: 'note1',
            command: 'nmap 10.0.0.1',
            variables: { TargetIP: '10.0.0.1' },
            type: 'run',
            timestamp: '2024-01-01T00:00:00Z',
            user: 'tester'
          }
        ];
      });

      const res = await request(app)
        .get(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].command).toBe('nmap 10.0.0.1');
      expect(res.body[0].playbookTitle).toBe('Initial Recon');
    });

    it('should return 404 for non-existent tab', async () => {
      await request(app)
        .get('/api/tabs/99999999/audit')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('POST /api/tabs/:tabId/audit - Log entry', () => {
    beforeAll(async () => {
      ctx.clearBroadcasts();
      // Reset audit log
      await ctx.storage.atomicUpdateRoomTabs(roomId, data => {
        const tab = data.tabs.find(t => t.id === tabId);
        tab.auditLog = [];
      });
    });

    it('should add minimal audit entry (command only)', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 'nmap -sV 10.0.0.1' })
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.entry).toHaveProperty('id');
      expect(res.body.entry.command).toBe('nmap -sV 10.0.0.1');
      expect(res.body.entry.user).toBe('tester');
      expect(res.body.entry.playbookTitle).toBe('');
      expect(res.body.entry.noteId).toBe('');
      expect(res.body.entry.variables).toEqual({});
      expect(res.body.entry.type).toBe('run');
      expect(res.body.entry).toHaveProperty('timestamp');

      // Verify broadcast
      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('audit-logged');
      expect(ctx.broadcasts[0].event.tabId).toBe(tabId);
      expect(ctx.broadcasts[0].event.entry.command).toBe('nmap -sV 10.0.0.1');
    });

    it('should add complete audit entry with all fields', async () => {
      ctx.clearBroadcasts();

      const res = await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          playbookTitle: 'Port Scanning',
          noteId: 'port-scan',
          command: 'nmap -p- <TargetIP>',
          variables: { TargetIP: '192.168.1.100' },
          type: 'run'
        })
        .expect(200);

      expect(res.body.entry.playbookTitle).toBe('Port Scanning');
      expect(res.body.entry.noteId).toBe('port-scan');
      expect(res.body.entry.command).toBe('nmap -p- <TargetIP>');
      expect(res.body.entry.variables).toEqual({ TargetIP: '192.168.1.100' });
      expect(res.body.entry.type).toBe('run');
    });

    it('should accept type: rerun', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 'ls -la', type: 'rerun' })
        .expect(200);

      expect(res.body.entry.type).toBe('rerun');
    });

    it('should accept type: manual', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 'whoami', type: 'manual' })
        .expect(200);

      expect(res.body.entry.type).toBe('manual');
    });

    it('should cap audit log at MAX_AUDIT_ENTRIES (200)', async () => {
      // Clear audit log
      await ctx.storage.atomicUpdateRoomTabs(roomId, data => {
        const tab = data.tabs.find(t => t.id === tabId);
        tab.auditLog = [];
      });

      // Add more than 200 entries
      for (let i = 0; i < 205; i++) {
        await request(app)
          .post(`/api/tabs/${tabId}/audit`)
          .set('Authorization', `Bearer ${token}`)
          .send({ command: `command-${i}` })
          .expect(200);
      }

      // Verify capped at 200
      const data = await ctx.storage.readRoomTabs(roomId);
      const tab = data.tabs.find(t => t.id === tabId);
      expect(tab.auditLog).toHaveLength(200);
      // Should keep most recent
      expect(tab.auditLog[199].command).toBe('command-204');
    });

    it('should reject missing command', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('should reject command exceeding MAX_COMMAND_LENGTH', async () => {
      const longCommand = 'a'.repeat(60000);
      await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: longCommand })
        .expect(400);
    });

    it('should reject non-string command', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 123 })
        .expect(400);
    });

    it('should reject playbookTitle exceeding 500 characters', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          command: 'test',
          playbookTitle: 'a'.repeat(501)
        })
        .expect(400);
    });

    it('should reject noteId exceeding 100 characters', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          command: 'test',
          noteId: 'a'.repeat(101)
        })
        .expect(400);
    });

    it('should reject invalid type', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          command: 'test',
          type: 'invalid'
        })
        .expect(400);
    });

    it('should reject non-object variables', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          command: 'test',
          variables: 'not-an-object'
        })
        .expect(400);
    });

    it('should reject array variables', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          command: 'test',
          variables: ['array']
        })
        .expect(400);
    });

    it('should reject variables exceeding 10000 characters when serialized', async () => {
      const largeVars = {};
      for (let i = 0; i < 1000; i++) {
        largeVars[`key${i}`] = 'a'.repeat(20);
      }

      await request(app)
        .post(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          command: 'test',
          variables: largeVars
        })
        .expect(400);
    });

    it('should return 404 for non-existent tab', async () => {
      await request(app)
        .post('/api/tabs/99999999/audit')
        .set('Authorization', `Bearer ${token}`)
        .send({ command: 'test' })
        .expect(404);
    });
  });

  describe('DELETE /api/tabs/:tabId/audit - Clear audit log', () => {
    beforeAll(async () => {
      ctx.clearBroadcasts();
      // Add some audit entries
      await ctx.storage.atomicUpdateRoomTabs(roomId, data => {
        const tab = data.tabs.find(t => t.id === tabId);
        tab.auditLog = [
          { id: 'audit1', command: 'test1', timestamp: '2024-01-01T00:00:00Z', user: 'tester' },
          { id: 'audit2', command: 'test2', timestamp: '2024-01-01T00:01:00Z', user: 'tester' }
        ];
      });
    });

    it('should clear all audit log entries', async () => {
      const res = await request(app)
        .delete(`/api/tabs/${tabId}/audit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.ok).toBe(true);

      // Verify audit log cleared
      const data = await ctx.storage.readRoomTabs(roomId);
      const tab = data.tabs.find(t => t.id === tabId);
      expect(tab.auditLog).toEqual([]);

      // Verify broadcast
      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('audit-cleared');
      expect(ctx.broadcasts[0].event.tabId).toBe(tabId);
    });

    it('should return 404 for non-existent tab', async () => {
      await request(app)
        .delete('/api/tabs/99999999/audit')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
