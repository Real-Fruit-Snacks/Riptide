'use strict';
const path = require('path');
const fsp = require('fs').promises;
const express = require('express');

module.exports = function(ctx) {
  const router = express.Router();
  const { storage, requireRoom, validateTabId, broadcastToRoom, LIMITS } = ctx;

  // Route-specific large body parser for POST (recordings can be large)
  const largeBody = express.json({ limit: '50mb' });

  // Sanitize recording name for use as filename
  function sanitizeName(name) {
    return name
      .replace(/[^a-zA-Z0-9_\-. ]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, LIMITS.MAX_RECORDING_NAME || 100);
  }

  // List recordings for a tab
  router.get('/tabs/:tabId/recordings', requireRoom, validateTabId, async (req, res) => {
    try {
      const recordings = await storage.readRecordingsList(req.roomId, req.params.tabId);
      res.json(recordings);
    } catch (err) {
      console.error('Recording list error:', err);
      res.status(500).json({ error: 'Failed to list recordings' });
    }
  });

  // Save a new recording
  router.post('/tabs/:tabId/recordings', requireRoom, validateTabId, largeBody, async (req, res) => {
    try {
      const { name, cast } = req.body;
      if (!cast || typeof cast !== 'string' || cast.trim().length === 0) {
        return res.status(400).json({ error: 'cast data is required' });
      }

      const safeName = sanitizeName(name || 'recording');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = ts + '-' + safeName + '.cast';

      const dir = await storage.ensureRecordingsDir(req.roomId, req.params.tabId);
      const filePath = path.join(dir, filename);

      await fsp.writeFile(filePath, cast, 'utf-8');

      const stat = await fsp.stat(filePath);
      const recording = {
        name: filename,
        size: stat.size,
        modified: stat.mtime.toISOString()
      };

      broadcastToRoom(req.roomId, {
        type: 'recording-saved',
        tabId: req.params.tabId,
        recording,
        user: req.nickname
      }, req.token);

      res.json({ ok: true, recording });
    } catch (err) {
      console.error('Recording save error:', err);
      res.status(500).json({ error: 'Failed to save recording' });
    }
  });

  // Download a recording
  router.get('/tabs/:tabId/recordings/:filename', requireRoom, validateTabId, async (req, res) => {
    try {
      const filename = req.params.filename;
      if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      if (!filename.endsWith('.cast')) {
        return res.status(400).json({ error: 'Invalid file type' });
      }

      const dir = await storage.resolveRecordingsDir(req.roomId, req.params.tabId);
      const filePath = path.join(dir, filename);
      const resolved = path.resolve(filePath);
      const resolvedDir = path.resolve(dir);

      if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      if (!await storage.fileExists(resolved)) {
        return res.status(404).json({ error: 'Recording not found' });
      }
      res.download(resolved, filename);
    } catch (err) {
      console.error('Recording download error:', err);
      res.status(500).json({ error: 'Failed to download recording' });
    }
  });

  // Delete a recording
  router.delete('/tabs/:tabId/recordings/:filename', requireRoom, validateTabId, async (req, res) => {
    try {
      const filename = req.params.filename;
      if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      const dir = await storage.resolveRecordingsDir(req.roomId, req.params.tabId);
      const filePath = path.join(dir, filename);
      const resolved = path.resolve(filePath);
      const resolvedDir = path.resolve(dir);

      if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      if (!await storage.fileExists(resolved)) {
        return res.status(404).json({ error: 'Recording not found' });
      }
      await fsp.unlink(resolved);

      broadcastToRoom(req.roomId, {
        type: 'recording-deleted',
        tabId: req.params.tabId,
        filename,
        user: req.nickname
      }, req.token);

      res.json({ ok: true });
    } catch (err) {
      console.error('Recording delete error:', err);
      res.status(500).json({ error: 'Failed to delete recording' });
    }
  });

  return router;
};
