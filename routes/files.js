'use strict';
const path = require('path');
const fsp = require('fs').promises;
const express = require('express');

module.exports = function(ctx) {
  const router = express.Router();
  const { storage, requireRoom, validateTabId, fileUpload, broadcastToRoom } = ctx;

  // Allowed file extensions for upload (case-insensitive)
  const ALLOWED_EXTENSIONS = new Set([
    // Documents
    '.txt', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.json', '.xml', '.yaml', '.yml', '.html', '.htm',
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico',
    // Archives
    '.zip', '.tar', '.gz', '.7z', '.rar', '.tgz',
    // Scripts & code (useful for CTF/pentesting)
    '.py', '.sh', '.bash', '.rb', '.pl', '.ps1', '.bat', '.cmd', '.js', '.ts', '.c', '.cpp', '.h', '.java', '.go', '.rs',
    // Security/pentest files
    '.nmap', '.gnmap', '.xml', '.conf', '.cfg', '.ini', '.log', '.pcap', '.cap', '.rules',
    // Misc
    '.key', '.pem', '.crt', '.cer', '.csr', '.ovpn', '.rdp'
  ]);

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

  router.post('/tabs/:tabId/files', requireRoom, validateTabId, fileUpload.array('files', 20), async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      // Validate file size
      const oversized = req.files.filter(f => f.size > MAX_FILE_SIZE);
      if (oversized.length > 0) {
        for (const f of req.files) {
          try { await fsp.unlink(f.path); } catch { /* ignore */ }
        }
        return res.status(400).json({ error: 'File too large (max 50MB per file)' });
      }

      // Validate file extensions
      const rejected = [];
      for (const f of req.files) {
        const ext = path.extname(f.originalname).toLowerCase();
        if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
          rejected.push(f.originalname);
        }
      }
      if (rejected.length > 0) {
        // Clean up rejected files from disk
        for (const f of req.files) {
          try { await fsp.unlink(f.path); } catch { /* ignore */ }
        }
        return res.status(400).json({
          error: `File type not allowed: ${rejected.join(', ')}. Contact admin to add new extensions.`
        });
      }

      const uploaded = req.files.map(f => ({
        name: f.filename,
        originalName: f.originalname,
        size: f.size,
        uploadedBy: req.nickname,
        uploadedAt: new Date().toISOString()
      }));
      broadcastToRoom(req.roomId, {
        type: 'files-changed',
        tabId: req.params.tabId,
        user: req.nickname
      }, req.token);
      res.json({ files: uploaded });
    } catch (err) {
      console.error('File upload error:', err);
      res.status(500).json({ error: 'Failed to upload files' });
    }
  });

  router.get('/tabs/:tabId/files', requireRoom, validateTabId, async (req, res) => {
    try {
      const tabDir = await storage.resolveTabDataDir(req.roomId, req.params.tabId);
      const filesDir = path.join(tabDir, 'files');
      if (!await storage.fileExists(filesDir)) {
        return res.json([]);
      }
      const entries = await fsp.readdir(filesDir);
      const files = [];
      for (const name of entries) {
        const fullPath = path.join(filesDir, name);
        try {
          const stat = await fsp.stat(fullPath);
          if (stat.isFile()) {
            files.push({
              name,
              size: stat.size,
              modified: stat.mtime.toISOString()
            });
          }
        } catch {
          // skip inaccessible files
        }
      }
      // Sort by modified descending (newest first)
      files.sort((a, b) => new Date(b.modified) - new Date(a.modified));
      res.json(files);
    } catch (err) {
      console.error('File list error:', err);
      res.status(500).json({ error: 'Failed to list files' });
    }
  });

  router.get('/tabs/:tabId/files/:filename', requireRoom, validateTabId, async (req, res) => {
    try {
      const filename = req.params.filename;
      if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      const tabDir = await storage.resolveTabDataDir(req.roomId, req.params.tabId);
      const filePath = path.join(tabDir, 'files', filename);
      const resolved = path.resolve(filePath);
      const filesDir = path.resolve(path.join(tabDir, 'files'));
      if (!resolved.startsWith(filesDir + path.sep) && resolved !== filesDir) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      if (!await storage.fileExists(resolved)) {
        return res.status(404).json({ error: 'File not found' });
      }
      res.download(resolved, filename);
    } catch (err) {
      console.error('File download error:', err);
      res.status(500).json({ error: 'Failed to download file' });
    }
  });

  router.delete('/tabs/:tabId/files/:filename', requireRoom, validateTabId, async (req, res) => {
    try {
      const filename = req.params.filename;
      if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      const tabDir = await storage.resolveTabDataDir(req.roomId, req.params.tabId);
      const filePath = path.join(tabDir, 'files', filename);
      const resolved = path.resolve(filePath);
      const filesDir = path.resolve(path.join(tabDir, 'files'));
      if (!resolved.startsWith(filesDir + path.sep) && resolved !== filesDir) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      if (!await storage.fileExists(resolved)) {
        return res.status(404).json({ error: 'File not found' });
      }
      await fsp.unlink(resolved);
      broadcastToRoom(req.roomId, {
        type: 'files-changed',
        tabId: req.params.tabId,
        user: req.nickname
      }, req.token);
      res.json({ ok: true });
    } catch (err) {
      console.error('File delete error:', err);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

  return router;
};
