'use strict';

const request = require('supertest');
const { createTestApp } = require('../helpers/test-app');
const { createMockContext } = require('../helpers/mock-context');

let ctx, app, cleanup, token;

describe('Knowledge Base API', () => {

  beforeEach(async () => {
    ctx = await createMockContext();
    // Create a room for auth
    const hashedPw = await require('../../lib/helpers').hashPassword('testpass');
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({ id: 'kbroom1', name: 'KB Test', passwordHash: hashedPw, creator: 'tester' });
    });
    token = ctx.addSession('kbroom1', 'tester');
    const knowledgeRoute = require('../../routes/knowledge');
    app = createTestApp(knowledgeRoute, ctx.routeCtx);
    cleanup = ctx.cleanup;
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
  });

  describe('POST /api/knowledge', () => {
    it('should require auth for creating entries', async () => {
      await request(app).post('/api/knowledge').send({ type: 'note', title: 'Test' }).expect(401);
    });

    it('should create a knowledge entry', async () => {
      const entry = {
        type: 'technique',
        title: 'SQL Injection Basics',
        content: 'Always try single quotes first',
        tags: ['web', 'sql', 'injection'],
        sourceRoom: 'ctf-room-1',
        sourceTab: 'web-app',
        addedBy: 'alice',
        references: ['https://portswigger.net/web-security/sql-injection']
      };

      const res = await request(app)
        .post('/api/knowledge')
        .set('Authorization', `Bearer ${token}`)
        .send(entry)
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.entry).toMatchObject({
        type: 'technique',
        title: 'SQL Injection Basics',
        content: 'Always try single quotes first',
        tags: ['web', 'sql', 'injection']
      });
      expect(res.body.entry.id).toMatch(/^[a-f0-9]{16}$/);
      expect(res.body.entry.timestamp).toBeTruthy();
    });

    it('should require title and type', async () => {
      const res = await request(app)
        .post('/api/knowledge')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'test' })
        .expect(400);

      expect(res.body.error).toContain('Title is required');
      expect(res.body.error).toContain('Type is required');
    });

    it('should validate type against allowed types', async () => {
      const res = await request(app)
        .post('/api/knowledge')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'invalid', title: 'Test' })
        .expect(400);

      expect(res.body.error).toContain('Type must be one of');
    });

    it('should enforce title length limits', async () => {
      const res = await request(app)
        .post('/api/knowledge')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'note', title: 'a'.repeat(201) })
        .expect(400);

      expect(res.body.error).toContain('Title must be 1-200 characters');
    });

    it('should enforce tag limits', async () => {
      const res = await request(app)
        .post('/api/knowledge')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'note',
          title: 'Test',
          tags: Array(21).fill('tag')
        })
        .expect(400);

      expect(res.body.error).toContain('Maximum 20 tags allowed');
    });

    it('should normalize tags to lowercase', async () => {
      const res = await request(app)
        .post('/api/knowledge')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'note',
          title: 'Test',
          tags: ['WEB', 'SQL', 'Injection']
        })
        .expect(200);

      expect(res.body.entry.tags).toEqual(['web', 'sql', 'injection']);
    });

    it('should update tag counts', async () => {
      await request(app)
        .post('/api/knowledge')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'technique',
          title: 'Test 1',
          tags: ['web', 'sql']
        })
        .expect(200);

      await request(app)
        .post('/api/knowledge')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'technique',
          title: 'Test 2',
          tags: ['web', 'xss']
        })
        .expect(200);

      const res = await request(app)
        .get('/api/knowledge/tags')
        .expect(200);

      expect(res.body.tags).toEqual({
        web: 2,
        sql: 1,
        xss: 1
      });
    });
  });

  describe('GET /api/knowledge', () => {
    beforeEach(async () => {
      // Create test entries
      await request(app).post('/api/knowledge').set('Authorization', `Bearer ${token}`).send({
        type: 'technique',
        title: 'SQL Injection',
        content: 'SQL injection techniques',
        tags: ['web', 'sql']
      });

      await request(app).post('/api/knowledge').set('Authorization', `Bearer ${token}`).send({
        type: 'service',
        title: 'Apache Config',
        content: 'Apache configuration tips',
        tags: ['web', 'apache']
      });

      await request(app).post('/api/knowledge').set('Authorization', `Bearer ${token}`).send({
        type: 'tool',
        title: 'Nmap',
        content: 'Network scanning with nmap',
        tags: ['recon', 'network']
      });
    });

    it('should list all entries', async () => {
      const res = await request(app)
        .get('/api/knowledge')
        .expect(200);

      expect(res.body.entries).toHaveLength(3);
      expect(res.body.total).toBe(3);
    });

    it('should search by query string', async () => {
      const res = await request(app)
        .get('/api/knowledge?q=sql')
        .expect(200);

      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].title).toBe('SQL Injection');
    });

    it('should filter by tag', async () => {
      const res = await request(app)
        .get('/api/knowledge?tag=web')
        .expect(200);

      expect(res.body.entries).toHaveLength(2);
    });

    it('should filter by type', async () => {
      const res = await request(app)
        .get('/api/knowledge?type=tool')
        .expect(200);

      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].title).toBe('Nmap');
    });

    it('should combine query and tag filters', async () => {
      const res = await request(app)
        .get('/api/knowledge?q=apache&tag=web')
        .expect(200);

      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].title).toBe('Apache Config');
    });

    it('should sort by timestamp descending', async () => {
      const res = await request(app)
        .get('/api/knowledge')
        .expect(200);

      const timestamps = res.body.entries.map(e => new Date(e.timestamp));
      expect(timestamps[0] >= timestamps[1]).toBe(true);
      expect(timestamps[1] >= timestamps[2]).toBe(true);
    });
  });

  describe('GET /api/knowledge/:id', () => {
    let entryId;

    beforeEach(async () => {
      const res = await request(app).post('/api/knowledge').set('Authorization', `Bearer ${token}`).send({
        type: 'note',
        title: 'Test Entry'
      });
      entryId = res.body.entry.id;
    });

    it('should get a single entry by id', async () => {
      const res = await request(app)
        .get(`/api/knowledge/${entryId}`)
        .expect(200);

      expect(res.body.entry.id).toBe(entryId);
      expect(res.body.entry.title).toBe('Test Entry');
    });

    it('should return 404 for non-existent entry', async () => {
      const res = await request(app)
        .get('/api/knowledge/0123456789abcdef')
        .expect(404);

      expect(res.body.error).toBe('Entry not found');
    });

    it('should validate entry ID format', async () => {
      const res = await request(app)
        .get('/api/knowledge/invalid')
        .expect(400);

      expect(res.body.error).toBe('Invalid entry ID');
    });
  });

  describe('PUT /api/knowledge/:id', () => {
    let entryId;

    beforeEach(async () => {
      const res = await request(app).post('/api/knowledge').set('Authorization', `Bearer ${token}`).send({
        type: 'technique',
        title: 'Original Title',
        tags: ['web', 'old']
      });
      entryId = res.body.entry.id;
    });

    it('should update an entry', async () => {
      const res = await request(app)
        .put(`/api/knowledge/${entryId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Updated Title',
          content: 'New content'
        })
        .expect(200);

      expect(res.body.entry.title).toBe('Updated Title');
      expect(res.body.entry.content).toBe('New content');
      expect(res.body.entry.type).toBe('technique'); // unchanged
    });

    it('should update tag counts when tags change', async () => {
      await request(app)
        .put(`/api/knowledge/${entryId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tags: ['web', 'new'] })
        .expect(200);

      const res = await request(app)
        .get('/api/knowledge/tags')
        .expect(200);

      expect(res.body.tags).toEqual({
        web: 1,
        new: 1
      });
      expect(res.body.tags.old).toBeUndefined();
    });

    it('should return 404 for non-existent entry', async () => {
      const res = await request(app)
        .put('/api/knowledge/0123456789abcdef')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Test' })
        .expect(404);

      expect(res.body.error).toBe('Entry not found');
    });
  });

  describe('DELETE /api/knowledge/:id', () => {
    let entryId;

    beforeEach(async () => {
      const res = await request(app).post('/api/knowledge').set('Authorization', `Bearer ${token}`).send({
        type: 'note',
        title: 'To Delete',
        tags: ['temp']
      });
      entryId = res.body.entry.id;
    });

    it('should delete an entry', async () => {
      await request(app)
        .delete(`/api/knowledge/${entryId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app)
        .get(`/api/knowledge/${entryId}`)
        .expect(404);
    });

    it('should update tag counts on delete', async () => {
      await request(app)
        .delete(`/api/knowledge/${entryId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app)
        .get('/api/knowledge/tags')
        .expect(200);

      expect(res.body.tags.temp).toBeUndefined();
    });

    it('should return 404 for non-existent entry', async () => {
      const res = await request(app)
        .delete('/api/knowledge/0123456789abcdef')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(res.body.error).toBe('Entry not found');
    });
  });
});
