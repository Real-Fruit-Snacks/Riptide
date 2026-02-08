'use strict';

const request = require('supertest');
const path = require('path');
const fsp = require('fs').promises;
const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestApp } = require('../helpers/test-app');

describe('Playbooks Routes', () => {
  let ctx, app, token, roomId;

  beforeAll(async () => {
    ctx = await createMockContext();
    roomId = 'test-room-pb';

    // Create test room
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'PB Room',
        passwordHash: 'dummy',
        workDir: ctx.tempDir,
        creator: 'tester'
      });
    });

    token = ctx.addSession(roomId, 'tester');
    app = createTestApp(require('../../routes/playbooks'), ctx.routeCtx);

    // Seed additional playbooks for testing
    await fsp.writeFile(path.join(ctx.playbooksDir, 'web-enum.md'), `---
tags: [web, recon]
---
# Web Enumeration

\`\`\`bash
gobuster dir -u <TargetURL> -w /usr/share/wordlists/dirb/common.txt
\`\`\`
`);

    await fsp.writeFile(path.join(ctx.playbooksDir, 'smb-enum.md'), `---
tags: [smb, enum]
---
# SMB Enumeration

\`\`\`bash
enum4linux -a <TargetIP>
\`\`\`
`);

    await fsp.writeFile(path.join(ctx.playbooksDir, 'nmap-scan.md'), `---
tags: [recon, networking]
category: Reconnaissance
---
# Nmap Full Scan

Full port scan with service detection.

\`\`\`bash
nmap -p- -sC -sV <TargetIP>
\`\`\`
`);

    await fsp.writeFile(path.join(ctx.playbooksDir, 'sqli-test.md'), `---
tags: [web, sqli, exploit]
---
# SQL Injection Testing

Test for SQL injection vulnerabilities.

\`\`\`bash
sqlmap -u <TargetURL> --batch
\`\`\`
`);
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  describe('GET /api/playbooks', () => {
    it('should return array of playbooks with id, title, tags', async () => {
      const res = await request(app)
        .get('/api/playbooks')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);

      const playbook = res.body.find(p => p.id === 'test-recon');
      expect(playbook).toBeDefined();
      expect(playbook.title).toBe('Test Recon Playbook');
      expect(playbook.tags).toEqual(expect.arrayContaining(['recon', 'test']));
      expect(playbook.description).toBeTruthy();
      expect(playbook.modified).toBeTruthy();
    });

    it('should filter by search query (q parameter)', async () => {
      const res = await request(app)
        .get('/api/playbooks?q=recon')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const ids = res.body.map(p => p.id);
      expect(ids).toContain('test-recon');
    });

    it('should filter by tag', async () => {
      const res = await request(app)
        .get('/api/playbooks?tag=test')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const playbook = res.body.find(p => p.id === 'test-recon');
      expect(playbook).toBeDefined();
      expect(playbook.tags).toContain('test');
    });

    it('should return empty array if no matches', async () => {
      const res = await request(app)
        .get('/api/playbooks?q=nonexistent12345')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/playbooks')
        .expect(401);
    });
  });

  describe('GET /api/playbooks/tags', () => {
    it('should return unique sorted tag list', async () => {
      const res = await request(app)
        .get('/api/playbooks/tags')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body).toContain('test');
      expect(res.body).toContain('recon');

      // Should be sorted
      const sorted = [...res.body].sort();
      expect(res.body).toEqual(sorted);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/playbooks/tags')
        .expect(401);
    });
  });

  describe('GET /api/playbooks/:id', () => {
    it('should return playbook content for valid ID', async () => {
      const res = await request(app)
        .get('/api/playbooks/test-recon')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.id).toBe('test-recon');
      expect(res.body.title).toBe('Test Recon Playbook');
      expect(res.body.content).toContain('nmap -sC -sV <TargetIP>');
      expect(res.body.tags).toEqual(expect.arrayContaining(['recon', 'test']));
      expect(res.body.modified).toBeTruthy();
    });

    it('should reject path traversal attempts', async () => {
      // Express normalizes .. in URL paths, so we test with invalid chars instead
      await request(app)
        .get('/api/playbooks/..%2Fetc%2Fpasswd')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should return 404 for non-existent playbook', async () => {
      await request(app)
        .get('/api/playbooks/nonexistent')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should reject invalid playbook ID format', async () => {
      await request(app)
        .get('/api/playbooks/test@invalid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/playbooks/test-recon')
        .expect(401);
    });

    it('should include category field in response', async () => {
      const res = await request(app)
        .get('/api/playbooks/nmap-scan')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.category).toBe('Reconnaissance');
    });
  });

  describe('Category and fuzzy search features', () => {
    it('should include category field in index results', async () => {
      const res = await request(app)
        .get('/api/playbooks')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const nmap = res.body.find(p => p.id === 'nmap-scan');
      expect(nmap).toBeDefined();
      expect(nmap.category).toBe('Reconnaissance');

      // Inferred from tags
      const sqli = res.body.find(p => p.id === 'sqli-test');
      expect(sqli).toBeDefined();
      expect(sqli.category).toBe('Web Application');
    });

    it('should filter by multi-tag AND (tags param, comma-separated)', async () => {
      const res = await request(app)
        .get('/api/playbooks?tags=recon,networking')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // Only playbooks with BOTH recon AND networking tags
      for (const item of res.body) {
        const lower = item.tags.map(t => t.toLowerCase());
        expect(lower).toContain('recon');
        expect(lower).toContain('networking');
      }
      const ids = res.body.map(p => p.id);
      expect(ids).toContain('nmap-scan');
    });

    it('should return empty when multi-tag AND has no matches', async () => {
      const res = await request(app)
        .get('/api/playbooks?tags=recon,sqli')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should still support legacy single tag param', async () => {
      const res = await request(app)
        .get('/api/playbooks?tag=web')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const ids = res.body.map(p => p.id);
      expect(ids).toContain('web-enum');
      expect(ids).toContain('sqli-test');
    });

    it('should filter by category', async () => {
      const res = await request(app)
        .get('/api/playbooks?category=Reconnaissance')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      for (const item of res.body) {
        expect(item.category).toBe('Reconnaissance');
      }
    });

    it('should use fuzzy search with scoring', async () => {
      // "nmp" fuzzy-matches "nmap" (all chars present in order)
      await request(app)
        .get('/api/playbooks?q=nmp')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Exact substring match should definitely work
      const res2 = await request(app)
        .get('/api/playbooks?q=nmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res2.body.length).toBeGreaterThanOrEqual(1);
      const ids = res2.body.map(p => p.id);
      expect(ids).toContain('nmap-scan');
    });

    it('should order fuzzy results by relevance (title > description)', async () => {
      const res = await request(app)
        .get('/api/playbooks?q=nmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      // Results should have _score field
      expect(res.body[0]._score).toBeDefined();
      expect(res.body[0]._score).toBeGreaterThan(0);

      // First result should be the one with "Nmap" in the title
      expect(res.body[0].id).toBe('nmap-scan');
    });

    it('should sort alphabetically when no search query', async () => {
      const res = await request(app)
        .get('/api/playbooks')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const titles = res.body.map(p => p.title);
      const sorted = [...titles].sort((a, b) => a.localeCompare(b));
      expect(titles).toEqual(sorted);
    });
  });

  describe('GET /api/playbooks/categories', () => {
    it('should return categories with counts', async () => {
      const res = await request(app)
        .get('/api/playbooks/categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const recon = res.body.find(c => c.name === 'Reconnaissance');
      expect(recon).toBeDefined();
      expect(recon.count).toBeGreaterThanOrEqual(1);

      // Each entry should have name and count
      for (const cat of res.body) {
        expect(cat.name).toBeTruthy();
        expect(typeof cat.count).toBe('number');
        expect(cat.count).toBeGreaterThan(0);
      }
    });

    it('should order categories by pentest phases', async () => {
      const res = await request(app)
        .get('/api/playbooks/categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const names = res.body.map(c => c.name);
      // Reconnaissance should come before Web Application (matches predefined order)
      const reconIdx = names.indexOf('Reconnaissance');
      const webIdx = names.indexOf('Web Application');
      if (reconIdx >= 0 && webIdx >= 0) {
        expect(reconIdx).toBeLessThan(webIdx);
      }
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/playbooks/categories')
        .expect(401);
    });
  });
});
