'use strict';
const crypto = require('crypto');
const express = require('express');

module.exports = function(ctx) {
  const router = express.Router();
  const { storage, LIMITS, requireRoom, broadcastToRoom } = ctx;

  router.get('/scratch-notes', requireRoom, async (req, res) => {
    try {
      const scope = req.query.scope;
      const tabId = req.query.tabId || null;

      if (!scope || (scope !== 'global' && scope !== 'tab')) {
        return res.status(400).json({ error: 'scope must be "global" or "tab"' });
      }

      if (scope === 'tab' && !tabId) {
        return res.status(400).json({ error: 'tabId is required for tab scope' });
      }

      if (scope === 'tab') {
        // Validate tab exists
        const data = await storage.readRoomTabs(req.roomId);
        if (!data || !data.tabs.find(t => t.id === tabId)) {
          return res.status(404).json({ error: 'Tab not found' });
        }
      }

      const notes = await storage.readScratchNotes(req.roomId, scope === 'tab' ? tabId : null);
      res.json(notes);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/scratch-notes', requireRoom, async (req, res) => {
    try {
      const { scope, tabId, text } = req.body;

      if (!scope || (scope !== 'global' && scope !== 'tab')) {
        return res.status(400).json({ error: 'scope must be "global" or "tab"' });
      }

      if (scope === 'tab' && !tabId) {
        return res.status(400).json({ error: 'tabId is required for tab scope' });
      }

      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'text is required' });
      }
      if (text.length > LIMITS.MAX_SCRATCH_NOTE_LENGTH) {
        return res.status(400).json({ error: 'Note text too long' });
      }

      if (scope === 'tab') {
        // Validate tab exists
        const data = await storage.readRoomTabs(req.roomId);
        if (!data || !data.tabs.find(t => t.id === tabId)) {
          return res.status(404).json({ error: 'Tab not found' });
        }
      }

      const effectiveTabId = scope === 'tab' ? tabId : null;
      const entry = {
        id: crypto.randomBytes(8).toString('hex'),
        text: text.trim(),
        timestamp: new Date().toISOString(),
        user: req.nickname,
        severity: req.body.severity || null
      };

      const result = await storage.atomicUpdateScratchNotes(req.roomId, effectiveTabId, (notes) => {
        if (notes.length >= LIMITS.MAX_SCRATCH_NOTES) {
          return false;
        }
        notes.push(entry);
        return entry;
      });

      if (result === false) {
        return res.status(400).json({ error: `Maximum scratch notes limit (${LIMITS.MAX_SCRATCH_NOTES}) reached` });
      }

      broadcastToRoom(req.roomId, {
        type: 'scratch-note-created',
        scope,
        tabId: scope === 'tab' ? tabId : undefined,
        entry
      }, req.token);

      res.json({ ok: true, entry });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/scratch-notes/:id/severity', requireRoom, async (req, res) => {
    try {
      const { scope, tabId, severity } = req.body;
      const noteId = req.params.id;
      const validSeverities = [null, 'info', 'low', 'medium', 'high', 'critical'];

      if (!scope || (scope !== 'global' && scope !== 'tab')) {
        return res.status(400).json({ error: 'scope must be "global" or "tab"' });
      }
      if (scope === 'tab' && !tabId) {
        return res.status(400).json({ error: 'tabId is required for tab scope' });
      }
      if (!validSeverities.includes(severity)) {
        return res.status(400).json({ error: 'Invalid severity' });
      }

      const effectiveTabId = scope === 'tab' ? tabId : null;
      const result = await storage.atomicUpdateScratchNotes(req.roomId, effectiveTabId, (notes) => {
        const note = notes.find(n => n.id === noteId);
        if (!note) return false;
        note.severity = severity;
        return true;
      });

      if (result === false) {
        return res.status(404).json({ error: 'Scratch note not found' });
      }

      broadcastToRoom(req.roomId, {
        type: 'scratch-note-severity-changed',
        scope,
        tabId: scope === 'tab' ? tabId : undefined,
        noteId,
        severity
      }, req.token);

      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.put('/scratch-notes/:id', requireRoom, async (req, res) => {
    try {
      const { scope, tabId, text } = req.body;
      const noteId = req.params.id;

      if (!scope || (scope !== 'global' && scope !== 'tab')) {
        return res.status(400).json({ error: 'scope must be "global" or "tab"' });
      }

      if (scope === 'tab' && !tabId) {
        return res.status(400).json({ error: 'tabId is required for tab scope' });
      }

      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'text is required' });
      }
      if (text.length > LIMITS.MAX_SCRATCH_NOTE_LENGTH) {
        return res.status(400).json({ error: 'Note text too long' });
      }

      if (scope === 'tab') {
        // Validate tab exists
        const data = await storage.readRoomTabs(req.roomId);
        if (!data || !data.tabs.find(t => t.id === tabId)) {
          return res.status(404).json({ error: 'Tab not found' });
        }
      }

      const effectiveTabId = scope === 'tab' ? tabId : null;
      const result = await storage.atomicUpdateScratchNotes(req.roomId, effectiveTabId, (notes) => {
        const note = notes.find(n => n.id === noteId);
        if (!note) return false;
        note.text = text.trim();
        note.timestamp = new Date().toISOString();
        return note;
      });

      if (result === false) {
        return res.status(404).json({ error: 'Scratch note not found' });
      }

      broadcastToRoom(req.roomId, {
        type: 'scratch-note-updated',
        scope,
        tabId: scope === 'tab' ? tabId : undefined,
        entry: result
      }, req.token);

      res.json({ ok: true, entry: result });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/scratch-notes/:id', requireRoom, async (req, res) => {
    try {
      const scope = req.query.scope;
      const tabId = req.query.tabId || null;
      const noteId = req.params.id;

      if (!scope || (scope !== 'global' && scope !== 'tab')) {
        return res.status(400).json({ error: 'scope must be "global" or "tab"' });
      }

      if (scope === 'tab' && !tabId) {
        return res.status(400).json({ error: 'tabId is required for tab scope' });
      }

      if (scope === 'tab') {
        // Validate tab exists
        const data = await storage.readRoomTabs(req.roomId);
        if (!data || !data.tabs.find(t => t.id === tabId)) {
          return res.status(404).json({ error: 'Tab not found' });
        }
      }

      const effectiveTabId = scope === 'tab' ? tabId : null;
      const result = await storage.atomicUpdateScratchNotes(req.roomId, effectiveTabId, (notes) => {
        const noteIndex = notes.findIndex(n => n.id === noteId);
        if (noteIndex === -1) return false;
        notes.splice(noteIndex, 1);
        return true;
      });

      if (result === false) {
        return res.status(404).json({ error: 'Scratch note not found' });
      }

      broadcastToRoom(req.roomId, {
        type: 'scratch-note-deleted',
        scope,
        tabId: scope === 'tab' ? tabId : undefined,
        noteId
      }, req.token);

      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
