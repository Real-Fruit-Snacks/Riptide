'use strict';

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');
const { createMockContext, cleanup } = require('../helpers/mock-context');
const { createTestApp } = require('../helpers/test-app');

describe('Files Routes', () => {
  let ctx, app, token, roomId, tabId, tabDir;

  beforeAll(async () => {
    ctx = await createMockContext();
    roomId = 'test-room-files';
    tabId = 'abc12345';

    // Create test room
    await ctx.storage.atomicUpdateRooms(rooms => {
      rooms.rooms.push({
        id: roomId,
        name: 'Files Room',
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
        name: 'TestTab',
        variables: {},
        history: []
      });
    });

    token = ctx.addSession(roomId, 'tester');

    // Replace stub fileUpload with real multer for upload testing
    const storage = ctx.storage;
    const uploadStorage = multer.diskStorage({
      destination: async (req, _file, cb) => {
        try {
          const td = await storage.resolveTabDataDir(req.roomId, req.params.tabId);
          const filesDir = path.join(td, 'files');
          await fsp.mkdir(filesDir, { recursive: true });
          cb(null, filesDir);
        } catch (err) {
          cb(err);
        }
      },
      filename: (_req, file, cb) => {
        const safe = storage.sanitizeForFilesystem(file.originalname);
        cb(null, safe);
      }
    });
    ctx.routeCtx.fileUpload = multer({
      storage: uploadStorage,
      limits: { fileSize: 100 * 1024 * 1024, files: 20 }
    });

    app = createTestApp(require('../../routes/files'), ctx.routeCtx);

    // Get tab directory for file operations
    tabDir = await ctx.storage.resolveTabDataDir(roomId, tabId);
  });

  afterAll(async () => {
    await cleanup(ctx);
  });

  beforeEach(async () => {
    // Clear files directory before each test
    const filesDir = path.join(tabDir, 'files');
    try {
      await fsp.rm(filesDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }
    await fsp.mkdir(filesDir, { recursive: true });
    ctx.clearBroadcasts();
  });

  describe('GET /api/tabs/:tabId/files', () => {
    it('should return empty array when no files exist', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return array of files with name and size', async () => {
      // Pre-create test files
      const filesDir = path.join(tabDir, 'files');
      await fsp.writeFile(path.join(filesDir, 'test.txt'), 'Hello World');
      await fsp.writeFile(path.join(filesDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47]));

      const res = await request(app)
        .get(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);

      const txtFile = res.body.find(f => f.name === 'test.txt');
      expect(txtFile).toBeDefined();
      expect(txtFile.size).toBe(11); // 'Hello World' = 11 bytes
      expect(txtFile.modified).toBeTruthy();

      const pngFile = res.body.find(f => f.name === 'image.png');
      expect(pngFile).toBeDefined();
      expect(pngFile.size).toBe(4);
    });

    it('should sort files by modified date descending (newest first)', async () => {
      const filesDir = path.join(tabDir, 'files');

      // Create files with slight delay to ensure different mtimes
      await fsp.writeFile(path.join(filesDir, 'old.txt'), 'old');
      await new Promise(resolve => setTimeout(resolve, 100));
      await fsp.writeFile(path.join(filesDir, 'new.txt'), 'new');

      const res = await request(app)
        .get(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body[0].name).toBe('new.txt');
      expect(res.body[1].name).toBe('old.txt');
    });

    it('should require valid tab ID', async () => {
      await request(app)
        .get('/api/tabs/invalid/files')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should require authentication', async () => {
      await request(app)
        .get(`/api/tabs/${tabId}/files`)
        .expect(401);
    });
  });

  describe('GET /api/tabs/:tabId/files/:filename', () => {
    beforeEach(async () => {
      // Pre-create test file
      const filesDir = path.join(tabDir, 'files');
      await fsp.writeFile(path.join(filesDir, 'test.txt'), 'Hello World');
    });

    it('should download file with correct content', async () => {
      const res = await request(app)
        .get(`/api/tabs/${tabId}/files/test.txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.text).toBe('Hello World');
    });

    it('should return 404 for non-existent file', async () => {
      await request(app)
        .get(`/api/tabs/${tabId}/files/nonexistent.txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should reject filename containing .. (path traversal)', async () => {
      // Filename containing .. is rejected by validation
      await request(app)
        .get(`/api/tabs/${tabId}/files/test..txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should reject filename containing forward slash', async () => {
      // Filename with / is rejected by validation (if it reaches the handler)
      // Note: Express may route this differently, so we test the validation logic
      await request(app)
        .get(`/api/tabs/${tabId}/files/test%2Ffile.txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should reject filename containing backslash', async () => {
      // Filename with \ is rejected by validation
      await request(app)
        .get(`/api/tabs/${tabId}/files/test%5Cfile.txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should require authentication', async () => {
      await request(app)
        .get(`/api/tabs/${tabId}/files/test.txt`)
        .expect(401);
    });
  });

  describe('DELETE /api/tabs/:tabId/files/:filename', () => {
    beforeEach(async () => {
      // Pre-create test file
      const filesDir = path.join(tabDir, 'files');
      await fsp.writeFile(path.join(filesDir, 'test.txt'), 'Hello World');
    });

    it('should delete file successfully', async () => {
      await request(app)
        .delete(`/api/tabs/${tabId}/files/test.txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Verify file is deleted
      const filesDir = path.join(tabDir, 'files');
      const exists = fs.existsSync(path.join(filesDir, 'test.txt'));
      expect(exists).toBe(false);
    });

    it('should broadcast files-changed event', async () => {
      await request(app)
        .delete(`/api/tabs/${tabId}/files/test.txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(ctx.broadcasts.length).toBe(1);
      expect(ctx.broadcasts[0].roomId).toBe(roomId);
      expect(ctx.broadcasts[0].event.type).toBe('files-changed');
      expect(ctx.broadcasts[0].event.tabId).toBe(tabId);
      expect(ctx.broadcasts[0].event.user).toBe('tester');
      expect(ctx.broadcasts[0].excludeToken).toBe(token);
    });

    it('should return 404 for non-existent file', async () => {
      await request(app)
        .delete(`/api/tabs/${tabId}/files/nonexistent.txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should reject filename containing .. (path traversal)', async () => {
      await request(app)
        .delete(`/api/tabs/${tabId}/files/test..txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should reject filename containing forward slash', async () => {
      await request(app)
        .delete(`/api/tabs/${tabId}/files/test%2Ffile.txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should require authentication', async () => {
      await request(app)
        .delete(`/api/tabs/${tabId}/files/test.txt`)
        .expect(401);
    });
  });

  describe('POST /api/tabs/:tabId/files (upload)', () => {
    it('should upload a file successfully', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('hello world'), 'test-upload.txt')
        .expect(200);

      expect(res.body.files).toBeDefined();
      expect(res.body.files.length).toBe(1);
      expect(res.body.files[0].originalName).toBe('test-upload.txt');
      expect(res.body.files[0].size).toBe(11);
      expect(res.body.files[0].uploadedBy).toBe('tester');
      expect(res.body.files[0].uploadedAt).toBeTruthy();
    });

    it('should reject upload without file', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(res.body.error).toMatch(/[Nn]o files/);
    });

    it('should sanitize filename with path traversal characters', async () => {
      const res = await request(app)
        .post(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('evil content'), '../evil.txt')
        .expect(200);

      // sanitizeForFilesystem replaces path separators with _ and strips leading dots
      // So ../evil.txt becomes __evil.txt or similar — NOT a path traversal
      const savedName = res.body.files[0].name;
      expect(savedName).not.toContain('..');
      expect(savedName).not.toContain('/');
      expect(savedName).not.toContain('\\');

      // Verify file is actually in the files directory, not escaped
      const filesDir = path.join(tabDir, 'files');
      const exists = fs.existsSync(path.join(filesDir, savedName));
      expect(exists).toBe(true);
    });

    it('should show uploaded file in list', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('list test'), 'listed-file.txt');

      const res = await request(app)
        .get(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const found = res.body.find(f => f.name === 'listed-file.txt');
      expect(found).toBeDefined();
      expect(found.size).toBe(9);
    });

    it('should allow downloading uploaded file with correct content', async () => {
      const content = 'download me please';
      await request(app)
        .post(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from(content), 'downloadable.txt');

      const res = await request(app)
        .get(`/api/tabs/${tabId}/files/downloadable.txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.text).toBe(content);
    });

    it('should overwrite file with duplicate filename', async () => {
      // First upload
      await request(app)
        .post(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('version 1'), 'dupe.txt')
        .expect(200);

      // Second upload with same name — multer diskStorage overwrites
      await request(app)
        .post(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('version 2'), 'dupe.txt')
        .expect(200);

      // Download and verify it's the newer version
      const res = await request(app)
        .get(`/api/tabs/${tabId}/files/dupe.txt`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.text).toBe('version 2');

      // List should only have one entry with this name
      const listRes = await request(app)
        .get(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const dupes = listRes.body.filter(f => f.name === 'dupe.txt');
      expect(dupes.length).toBe(1);
    });

    it('should broadcast files-changed event on upload', async () => {
      ctx.clearBroadcasts();

      await request(app)
        .post(`/api/tabs/${tabId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('broadcast test'), 'broadcast-file.txt')
        .expect(200);

      expect(ctx.broadcasts.length).toBe(1);
      expect(ctx.broadcasts[0].roomId).toBe(roomId);
      expect(ctx.broadcasts[0].event.type).toBe('files-changed');
      expect(ctx.broadcasts[0].event.tabId).toBe(tabId);
      expect(ctx.broadcasts[0].event.user).toBe('tester');
      expect(ctx.broadcasts[0].excludeToken).toBe(token);
    });

    it('should require authentication', async () => {
      await request(app)
        .post(`/api/tabs/${tabId}/files`)
        .attach('files', Buffer.from('no auth'), 'noauth.txt')
        .expect(401);
    });
  });
});
