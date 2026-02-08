'use strict';

const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestApp } = require('../helpers/test-app');
const request = require('supertest');

describe('Variables Routes', () => {
  let ctx, app, token, roomId;

  beforeAll(async () => {
    ctx = await createMockContext();
    roomId = 'vartest1';
    const hashedPw = await require('../../lib/helpers').hashPassword('testpass123');
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'Var Test Room',
        passwordHash: hashedPw,
        workDir: ctx.tempDir,
        creator: 'tester'
      });
    });
    token = ctx.addSession(roomId, 'tester');
    app = createTestApp(require('../../routes/variables'), ctx.routeCtx);
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  beforeEach(() => {
    ctx.clearBroadcasts();
  });

  describe('GET /api/variables', () => {
    it('returns variables object (empty initially)', async () => {
      const res = await request(app)
        .get('/api/variables')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('object');
      expect(Array.isArray(res.body)).toBe(false);
    });

    it('returns previously set variables', async () => {
      await request(app)
        .patch('/api/variables')
        .set('Authorization', `Bearer ${token}`)
        .send({ variables: { TargetIP: '10.10.10.1', Domain: 'example.com' } });

      const res = await request(app)
        .get('/api/variables')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        TargetIP: '10.10.10.1',
        Domain: 'example.com'
      });
    });
  });

  describe('PATCH /api/variables', () => {
    it('merges variables with valid update', async () => {
      const res = await request(app)
        .patch('/api/variables')
        .set('Authorization', `Bearer ${token}`)
        .send({ variables: { Host: 'target.local', Port: '8080' } });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.variables).toMatchObject({
        Host: 'target.local',
        Port: '8080'
      });
    });

    it('broadcasts global-variables-changed event', async () => {
      await request(app)
        .patch('/api/variables')
        .set('Authorization', `Bearer ${token}`)
        .send({ variables: { NewVar: 'value' } });

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0]).toMatchObject({
        roomId,
        event: {
          type: 'global-variables-changed',
          user: 'tester'
        }
      });
      expect(ctx.broadcasts[0].event.variables).toHaveProperty('NewVar', 'value');
    });

    it('rejects prototype pollution with constructor', async () => {
      const res = await request(app)
        .patch('/api/variables')
        .set('Authorization', `Bearer ${token}`)
        .send({ variables: { constructor: { polluted: true } } });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid variable name');
      expect(res.body.error).toContain('constructor');
    });

    it('rejects prototype pollution with prototype', async () => {
      const res = await request(app)
        .patch('/api/variables')
        .set('Authorization', `Bearer ${token}`)
        .send({ variables: { prototype: { polluted: true } } });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid variable name');
      expect(res.body.error).toContain('prototype');
    });

    it('rejects missing variables object', async () => {
      const res = await request(app)
        .patch('/api/variables')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('variables object required');
    });

    it('rejects array instead of object', async () => {
      const res = await request(app)
        .patch('/api/variables')
        .set('Authorization', `Bearer ${token}`)
        .send({ variables: ['not', 'an', 'object'] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('plain object');
    });

    it('merges with existing variables', async () => {
      // Set initial variables
      await request(app)
        .patch('/api/variables')
        .set('Authorization', `Bearer ${token}`)
        .send({ variables: { Var1: 'value1', Var2: 'value2' } });

      // Update with partial change
      const res = await request(app)
        .patch('/api/variables')
        .set('Authorization', `Bearer ${token}`)
        .send({ variables: { Var2: 'updated', Var3: 'new' } });

      expect(res.status).toBe(200);
      expect(res.body.variables).toMatchObject({
        Var1: 'value1',
        Var2: 'updated',
        Var3: 'new'
      });
    });
  });

  describe('DELETE /api/variables/:name', () => {
    it('removes named variable', async () => {
      // Set a variable
      await request(app)
        .patch('/api/variables')
        .set('Authorization', `Bearer ${token}`)
        .send({ variables: { ToDelete: 'temp', ToKeep: 'permanent' } });

      ctx.clearBroadcasts();

      // Delete it
      const deleteRes = await request(app)
        .delete('/api/variables/ToDelete')
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.ok).toBe(true);

      // Verify it's gone
      const getRes = await request(app)
        .get('/api/variables')
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.body).not.toHaveProperty('ToDelete');
      expect(getRes.body).toHaveProperty('ToKeep', 'permanent');
    });

    it('broadcasts global-variables-changed event', async () => {
      await request(app)
        .patch('/api/variables')
        .set('Authorization', `Bearer ${token}`)
        .send({ variables: { DelVar: 'test' } });

      ctx.clearBroadcasts();

      await request(app)
        .delete('/api/variables/DelVar')
        .set('Authorization', `Bearer ${token}`);

      expect(ctx.broadcasts).toHaveLength(1);
      expect(ctx.broadcasts[0].event.type).toBe('global-variables-changed');
    });

    it('returns 404 for non-existent variable', async () => {
      const res = await request(app)
        .delete('/api/variables/NonExistent')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('rejects invalid variable name format', async () => {
      const res = await request(app)
        .delete('/api/variables/invalid-name!')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid variable name');
    });
  });
});
