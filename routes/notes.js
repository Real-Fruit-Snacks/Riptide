'use strict';
const express = require('express');
const path = require('path');
const fsp = require('fs').promises;

module.exports = function(ctx) {
  const router = express.Router();
  const {
    storage, LIMITS, requireRoom, broadcastToRoom,
    validateTabId, validateNoteId, editLocks, roomLockKeys
  } = ctx;

  // GET /api/tabs/:tabId/notes
  router.get('/tabs/:tabId/notes', requireRoom, validateTabId, async (req, res) => {
    try {
      if (!await storage.fileExists(req.tabNotesDir)) {
        return res.json([]);
      }
      const data = req.tabsData;
      const tab = data ? data.tabs.find(t => t.id === req.params.tabId) : null;
      const severities = (tab && tab.noteSeverities) || {};
      const files = (await fsp.readdir(req.tabNotesDir)).filter(f => f.endsWith('.md'));
      const notes = await Promise.all(files.map(async f => {
        const id = f.replace(/\.md$/, '');
        const stat = await fsp.stat(path.join(req.tabNotesDir, f));
        return { id, title: id, modified: stat.mtime.toISOString(), severity: severities[id] || null };
      }));
      // Apply persisted order if available, else sort by mtime
      const order = await storage.getNotesOrder(req.roomId, req.params.tabId);
      if (order && Array.isArray(order)) {
        const orderMap = new Map(order.map((id, idx) => [id, idx]));
        notes.sort((a, b) => {
          const aIdx = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
          const bIdx = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
          if (aIdx === Infinity && bIdx === Infinity) {
            return b.modified.localeCompare(a.modified);
          }
          return aIdx - bIdx;
        });
      } else {
        notes.sort((a, b) => b.modified.localeCompare(a.modified));
      }
      res.json(notes);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/tabs/:tabId/notes/order (must be before :noteId param route)
  router.put('/tabs/:tabId/notes/order', requireRoom, validateTabId, async (req, res) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array of note IDs' });
      }

      await storage.saveNotesOrder(req.roomId, req.params.tabId, order);

      broadcastToRoom(req.roomId, {
        type: 'notes-reordered',
        tabId: req.params.tabId,
        order,
        user: req.nickname
      }, req.token);

      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/tabs/:tabId/notes/:noteId
  router.get('/tabs/:tabId/notes/:noteId', requireRoom, validateTabId, validateNoteId, async (req, res) => {
    try {
      if (!await storage.fileExists(req.notePath)) {
        return res.status(404).json({ error: 'Note not found' });
      }
      const content = await fsp.readFile(req.notePath, 'utf-8');
      const stat = await fsp.stat(req.notePath);
      const id = req.params.noteId;
      res.json({ id, title: id, content, modified: stat.mtime.toISOString() });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/tabs/:tabId/notes
  router.post('/tabs/:tabId/notes', requireRoom, validateTabId, async (req, res) => {
    try {
      const { title } = req.body;
      if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Title is required' });
      }
      const baseId = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!baseId) {
        return res.status(400).json({ error: 'Invalid title' });
      }
      await storage.ensureTabDataDir(req.roomId, req.params.tabId);
      let id = baseId;
      let filePath = path.join(req.tabNotesDir, id + '.md');
      let suffix = 2;
      const content = req.body.content || `# ${title.trim()}\n\n`;
      // Atomic create: wx flag fails if file already exists (avoids TOCTOU)
      const MAX_RETRIES = 100;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          await fsp.writeFile(filePath, content, { flag: 'wx' });
          break;
        } catch (err) {
          if (err.code === 'EEXIST') {
            id = baseId + '-' + suffix;
            filePath = path.join(req.tabNotesDir, id + '.md');
            suffix++;
          } else {
            throw err;
          }
        }
      }
      const stat = await fsp.stat(filePath);
      const note = { id, title: id, content, modified: stat.mtime.toISOString() };

      // Append to order list if it exists
      const existingOrder = await storage.getNotesOrder(req.roomId, req.params.tabId);
      if (existingOrder) {
        existingOrder.push(id);
        await storage.saveNotesOrder(req.roomId, req.params.tabId, existingOrder);
      }

      broadcastToRoom(req.roomId, {
        type: 'note-created', tabId: req.params.tabId, note, user: req.nickname
      }, req.token);

      res.status(201).json(note);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/tabs/:tabId/notes/:noteId
  router.put('/tabs/:tabId/notes/:noteId', requireRoom, validateTabId, validateNoteId, async (req, res) => {
    try {
      if (!await storage.fileExists(req.notePath)) {
        return res.status(404).json({ error: 'Note not found' });
      }
      const { content } = req.body;
      if (content === undefined) {
        return res.status(400).json({ error: 'Content is required' });
      }
      // Limit note content size
      if (typeof content === 'string' && Buffer.byteLength(content, 'utf-8') > LIMITS.MAX_NOTE_BYTES) {
        return res.status(413).json({ error: 'Note content too large (max 1MB)' });
      }
      await storage.withWriteLock(req.notePath, async () => {
        await fsp.writeFile(req.notePath, content);
      });
      const stat = await fsp.stat(req.notePath);
      const id = req.params.noteId;

      broadcastToRoom(req.roomId, {
        type: 'note-updated', tabId: req.params.tabId, noteId: id, content, user: req.nickname
      }, req.token);

      res.json({ id, title: id, content, modified: stat.mtime.toISOString() });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PATCH /api/tabs/:tabId/notes/:noteId/severity
  router.patch('/tabs/:tabId/notes/:noteId/severity', requireRoom, validateTabId, validateNoteId, async (req, res) => {
    try {
      const { severity } = req.body;
      const allowed = ['info', 'low', 'medium', 'high', 'critical', null];
      if (!allowed.includes(severity)) {
        return res.status(400).json({ error: 'severity must be one of: info, low, medium, high, critical, or null' });
      }

      let notFound = false;
      await storage.atomicUpdateRoomTabs(req.roomId, (data) => {
        const tab = data.tabs.find(t => t.id === req.params.tabId);
        if (!tab) { notFound = true; return false; }
        if (!tab.noteSeverities) tab.noteSeverities = {};
        if (severity === null) {
          delete tab.noteSeverities[req.params.noteId];
        } else {
          tab.noteSeverities[req.params.noteId] = severity;
        }
      });
      if (notFound) return res.status(404).json({ error: 'Tab not found' });

      broadcastToRoom(req.roomId, {
        type: 'note-severity-changed',
        tabId: req.params.tabId,
        noteId: req.params.noteId,
        severity,
        user: req.nickname
      }, req.token);

      res.json({ ok: true, severity });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/tabs/:tabId/notes/:noteId/append
  router.post('/tabs/:tabId/notes/:noteId/append', requireRoom, validateTabId, validateNoteId, async (req, res) => {
    try {
      if (!await storage.fileExists(req.notePath)) {
        return res.status(404).json({ error: 'Note not found' });
      }
      const { content: appendContent } = req.body;
      if (!appendContent) {
        return res.status(400).json({ error: 'content is required' });
      }
      // Limit note content size
      if (typeof appendContent === 'string' && Buffer.byteLength(appendContent, 'utf-8') > LIMITS.MAX_NOTE_BYTES) {
        return res.status(413).json({ error: 'Note content too large (max 1MB)' });
      }

      let fullContent;
      await storage.withWriteLock(req.notePath, async () => {
        await fsp.appendFile(req.notePath, appendContent);
        fullContent = await fsp.readFile(req.notePath, 'utf-8');
      });
      const stat = await fsp.stat(req.notePath);

      broadcastToRoom(req.roomId, {
        type: 'note-updated',
        tabId: req.params.tabId,
        noteId: req.params.noteId,
        content: fullContent,
        user: req.nickname
      }, req.token);

      res.json({ ok: true, modified: stat.mtime.toISOString() });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/tabs/:tabId/notes/:noteId
  router.delete('/tabs/:tabId/notes/:noteId', requireRoom, validateTabId, validateNoteId, async (req, res) => {
    try {
      if (!await storage.fileExists(req.notePath)) {
        return res.status(404).json({ error: 'Note not found' });
      }
      await fsp.unlink(req.notePath);

      // Remove from order list if it exists
      const existingOrder = await storage.getNotesOrder(req.roomId, req.params.tabId);
      if (existingOrder) {
        const newOrder = existingOrder.filter(oid => oid !== req.params.noteId);
        await storage.saveNotesOrder(req.roomId, req.params.tabId, newOrder);
      }

      // Clear any edit lock for this note
      const lockKey = `${req.roomId}:${req.params.tabId}:${req.params.noteId}`;
      editLocks.delete(lockKey);
      roomLockKeys.get(req.roomId)?.delete(lockKey);

      broadcastToRoom(req.roomId, {
        type: 'note-deleted', tabId: req.params.tabId, noteId: req.params.noteId, user: req.nickname
      }, req.token);

      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
