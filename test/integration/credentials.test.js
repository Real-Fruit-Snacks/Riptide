'use strict';

const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestApp } = require('../helpers/test-app');
const request = require('supertest');

describe('Credentials Routes', () => {
  let ctx, app, token, roomId, tabId;

  beforeAll(async () => {
    ctx = await createMockContext();
    roomId = 'credtest1';
    const hashedPw = await require('../../lib/helpers').hashPassword('testpass123');
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'Cred Test Room',
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
    app = createTestApp(require('../../routes/credentials'), ctx.routeCtx);
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  beforeEach(() => {
    ctx.clearBroadcasts();
  });

  describe('Tab Credentials', () => {
    describe('POST /api/tabs/:tabId/credentials', () => {
      it('creates credential with valid fields', async () => {
        const res = await request(app)
          .post(`/api/tabs/${tabId}/credentials`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            service: 'SSH',
            username: 'root',
            password: 'toor',
            notes: 'Default creds'
          });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.credential).toMatchObject({
          service: 'SSH',
          username: 'root',
          password: 'toor',
          notes: 'Default creds',
          scope: 'tab',
          user: 'tester'
        });
        expect(res.body.credential.id).toMatch(/^[a-f0-9]{8,16}$/);
        expect(res.body.credential.timestamp).toBeTruthy();

        expect(ctx.broadcasts).toHaveLength(1);
        expect(ctx.broadcasts[0]).toMatchObject({
          roomId,
          event: {
            type: 'credential-created',
            tabId,
            credential: res.body.credential
          }
        });
      });

      it('rejects empty body when requireAtLeastOne is true', async () => {
        const res = await request(app)
          .post(`/api/tabs/${tabId}/credentials`)
          .set('Authorization', `Bearer ${token}`)
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('At least one');
      });

      it('rejects field over 2000 chars', async () => {
        const res = await request(app)
          .post(`/api/tabs/${tabId}/credentials`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            service: 'SSH',
            username: 'a'.repeat(2001)
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('under 2000 characters');
      });

      it('broadcasts credential-created event', async () => {
        await request(app)
          .post(`/api/tabs/${tabId}/credentials`)
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'FTP', username: 'admin' });

        expect(ctx.broadcasts).toHaveLength(1);
        expect(ctx.broadcasts[0].event.type).toBe('credential-created');
      });
    });

    describe('GET /api/tabs/:tabId/credentials', () => {
      it('returns array of credentials', async () => {
        // Create a credential first
        await request(app)
          .post(`/api/tabs/${tabId}/credentials`)
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'MySQL', username: 'dbuser', password: 'dbpass' });

        const res = await request(app)
          .get(`/api/tabs/${tabId}/credentials`)
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0]).toHaveProperty('id');
        expect(res.body[0]).toHaveProperty('service');
      });
    });

    describe('PUT /api/tabs/:tabId/credentials/:credId', () => {
      it('updates credential fields', async () => {
        // Create credential
        const createRes = await request(app)
          .post(`/api/tabs/${tabId}/credentials`)
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'SMTP', username: 'mailer' });

        const credId = createRes.body.credential.id;
        ctx.clearBroadcasts();

        // Update it
        const updateRes = await request(app)
          .put(`/api/tabs/${tabId}/credentials/${credId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ password: 'newpass123', notes: 'Updated password' });

        expect(updateRes.status).toBe(200);
        expect(updateRes.body.ok).toBe(true);
        expect(updateRes.body.credential).toMatchObject({
          service: 'SMTP',
          username: 'mailer',
          password: 'newpass123',
          notes: 'Updated password'
        });

        expect(ctx.broadcasts).toHaveLength(1);
        expect(ctx.broadcasts[0].event.type).toBe('credential-updated');
      });

      it('returns 404 for non-existent credId', async () => {
        const res = await request(app)
          .put(`/api/tabs/${tabId}/credentials/deadbeef`)
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'Updated' });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('not found');
      });

      it('returns 400 for invalid credId format', async () => {
        const res = await request(app)
          .put(`/api/tabs/${tabId}/credentials/invalid`)
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'Test' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid credential ID');
      });
    });

    describe('DELETE /api/tabs/:tabId/credentials/:credId', () => {
      it('removes credential and broadcasts event', async () => {
        // Create credential
        const createRes = await request(app)
          .post(`/api/tabs/${tabId}/credentials`)
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'Telnet', username: 'admin' });

        const credId = createRes.body.credential.id;
        ctx.clearBroadcasts();

        // Delete it
        const deleteRes = await request(app)
          .delete(`/api/tabs/${tabId}/credentials/${credId}`)
          .set('Authorization', `Bearer ${token}`);

        expect(deleteRes.status).toBe(200);
        expect(deleteRes.body.ok).toBe(true);

        expect(ctx.broadcasts).toHaveLength(1);
        expect(ctx.broadcasts[0].event).toMatchObject({
          type: 'credential-deleted',
          tabId,
          credentialId: credId
        });

        // Verify it's gone
        const getRes = await request(app)
          .get(`/api/tabs/${tabId}/credentials`)
          .set('Authorization', `Bearer ${token}`);

        expect(getRes.body.find(c => c.id === credId)).toBeUndefined();
      });

      it('returns 404 for non-existent credential', async () => {
        const res = await request(app)
          .delete(`/api/tabs/${tabId}/credentials/cafebabe`)
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(404);
      });
    });

    describe('POST /api/tabs/:tabId/credentials/export', () => {
      it('exports credentials to tab directory with workDir', async () => {
        // Create some credentials
        await request(app)
          .post(`/api/tabs/${tabId}/credentials`)
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'SSH', username: 'user1', password: 'pass1' });

        await request(app)
          .post(`/api/tabs/${tabId}/credentials`)
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'FTP', username: 'user2', hash: '$6$rounds...' });

        const res = await request(app)
          .post(`/api/tabs/${tabId}/credentials/export`)
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.dir).toBeTruthy();
        expect(res.body.files.some(f => f.includes('credentials.txt'))).toBe(true);
        expect(res.body.files.some(f => f.includes('usernames.txt'))).toBe(true);
        expect(res.body.files.some(f => f.includes('passwords_hashes.txt'))).toBe(true);
      });

      it('returns 400 when no credentials exist', async () => {
        // Create a new tab with no credentials
        const newTabId = 'bbbbcccc';
        await ctx.storage.atomicUpdateRoomTabs(roomId, tabs => {
          tabs.tabs.push({
            id: newTabId,
            name: 'EmptyTab',
            activeNoteId: null,
            variables: {},
            commandHistory: [],
            status: null,
            scope: {}
          });
        });

        const res = await request(app)
          .post(`/api/tabs/${newTabId}/credentials/export`)
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('No credentials');
      });
    });
  });

  describe('Global Credentials', () => {
    describe('POST /api/credentials', () => {
      it('creates global credential with valid fields', async () => {
        const res = await request(app)
          .post('/api/credentials')
          .set('Authorization', `Bearer ${token}`)
          .send({
            service: 'VPN',
            username: 'vpnuser',
            password: 'vpnpass'
          });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.credential).toMatchObject({
          service: 'VPN',
          username: 'vpnuser',
          password: 'vpnpass',
          scope: 'global',
          user: 'tester'
        });
        expect(res.body.credential.id).toMatch(/^[a-f0-9]{8,16}$/);

        expect(ctx.broadcasts).toHaveLength(1);
        expect(ctx.broadcasts[0].event.type).toBe('global-credential-created');
      });

      it('rejects empty body', async () => {
        const res = await request(app)
          .post('/api/credentials')
          .set('Authorization', `Bearer ${token}`)
          .send({});

        expect(res.status).toBe(400);
      });
    });

    describe('GET /api/credentials', () => {
      it('returns array of global credentials', async () => {
        await request(app)
          .post('/api/credentials')
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'LDAP', username: 'admin' });

        const res = await request(app)
          .get('/api/credentials')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
      });
    });

    describe('PUT /api/credentials/:credId', () => {
      it('updates global credential', async () => {
        const createRes = await request(app)
          .post('/api/credentials')
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'WiFi', password: 'oldwifipass' });

        const credId = createRes.body.credential.id;
        ctx.clearBroadcasts();

        const updateRes = await request(app)
          .put(`/api/credentials/${credId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ password: 'newwifipass', notes: 'Rotated' });

        expect(updateRes.status).toBe(200);
        expect(updateRes.body.credential.password).toBe('newwifipass');
        expect(updateRes.body.credential.notes).toBe('Rotated');

        expect(ctx.broadcasts).toHaveLength(1);
        expect(ctx.broadcasts[0].event.type).toBe('global-credential-updated');
      });

      it('returns 404 for non-existent credential', async () => {
        const res = await request(app)
          .put('/api/credentials/baadf00d')
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'Test' });

        expect(res.status).toBe(404);
      });
    });

    describe('DELETE /api/credentials/:credId', () => {
      it('deletes global credential', async () => {
        const createRes = await request(app)
          .post('/api/credentials')
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'API', username: 'apikey' });

        const credId = createRes.body.credential.id;
        ctx.clearBroadcasts();

        const deleteRes = await request(app)
          .delete(`/api/credentials/${credId}`)
          .set('Authorization', `Bearer ${token}`);

        expect(deleteRes.status).toBe(200);
        expect(deleteRes.body.ok).toBe(true);

        expect(ctx.broadcasts).toHaveLength(1);
        expect(ctx.broadcasts[0].event).toMatchObject({
          type: 'global-credential-deleted',
          credentialId: credId
        });
      });
    });

    describe('POST /api/credentials/export', () => {
      it('exports global credentials to room directory', async () => {
        await request(app)
          .post('/api/credentials')
          .set('Authorization', `Bearer ${token}`)
          .send({ service: 'Domain', username: 'administrator', password: 'P@ssw0rd' });

        const res = await request(app)
          .post('/api/credentials/export')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.dir).toBeTruthy();
        expect(res.body.files.some(f => f.includes('global_credentials.txt'))).toBe(true);
        expect(res.body.files.some(f => f.includes('global_usernames.txt'))).toBe(true);
        expect(res.body.files.some(f => f.includes('global_passwords_hashes.txt'))).toBe(true);
      });

      it('returns 400 when no global credentials exist', async () => {
        // Create new room with separate workDir and no credentials
        const newRoomId = 'emptyroom';
        const fs = require('fs');
        const path = require('path');
        const newWorkDir = path.join(ctx.tempDir, 'empty-room-dir');
        fs.mkdirSync(newWorkDir, { recursive: true });

        await ctx.storage.atomicUpdateRooms(rooms => {
          rooms.rooms.push({
            id: newRoomId,
            name: 'Empty Room',
            passwordHash: 'hash',
            workDir: newWorkDir,
            creator: 'tester'
          });
        });

        const newToken = ctx.addSession(newRoomId, 'tester');

        const res = await request(app)
          .post('/api/credentials/export')
          .set('Authorization', `Bearer ${newToken}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('No credentials');
      });
    });
  });
});
