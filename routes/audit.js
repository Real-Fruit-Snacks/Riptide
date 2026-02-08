'use strict';
const express = require('express');
const crypto = require('crypto');

module.exports = function(ctx) {
  const router = express.Router();
  const {
    storage, LIMITS, requireRoom, broadcastToRoom,
    validateTabId
  } = ctx;

  // GET /api/tabs/:tabId/audit
  router.get('/tabs/:tabId/audit', requireRoom, validateTabId, async (req, res) => {
    try {
      const data = await storage.readRoomTabs(req.roomId);
      const tab = data.tabs.find(t => t.id === req.params.tabId);
      if (!tab) return res.status(404).json({ error: 'Tab not found' });
      res.json(tab.auditLog || []);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/tabs/:tabId/audit
  router.post('/tabs/:tabId/audit', requireRoom, validateTabId, async (req, res) => {
    try {
      const { playbookTitle, noteId, command, variables, type } = req.body;
      if (!command) return res.status(400).json({ error: 'command is required' });
      if (typeof command !== 'string' || command.length > LIMITS.MAX_COMMAND_LENGTH) {
        return res.status(400).json({ error: `command must be a string under ${LIMITS.MAX_COMMAND_LENGTH} characters` });
      }
      if (playbookTitle && (typeof playbookTitle !== 'string' || playbookTitle.length > 500)) {
        return res.status(400).json({ error: 'playbookTitle must be a string under 500 characters' });
      }
      if (noteId && (typeof noteId !== 'string' || noteId.length > 100)) {
        return res.status(400).json({ error: 'noteId must be a string under 100 characters' });
      }
      if (type && (typeof type !== 'string' || !['run', 'rerun', 'manual'].includes(type))) {
        return res.status(400).json({ error: 'type must be one of: run, rerun, manual' });
      }
      if (variables !== undefined && variables !== null) {
        if (typeof variables !== 'object' || Array.isArray(variables)) {
          return res.status(400).json({ error: 'variables must be a plain object' });
        }
        const varsJson = JSON.stringify(variables);
        if (varsJson.length > 10000) {
          return res.status(400).json({ error: 'variables object too large' });
        }
      }

      let notFound = false;
      let entry = null;
      await storage.atomicUpdateRoomTabs(req.roomId, (data) => {
        const tab = data.tabs.find(t => t.id === req.params.tabId);
        if (!tab) { notFound = true; return false; }
        if (!tab.auditLog) tab.auditLog = [];
        entry = {
          id: crypto.randomBytes(8).toString('hex'),
          playbookTitle: playbookTitle || '',
          noteId: noteId || '',
          command,
          variables: variables || {},
          type: type || 'run',
          timestamp: new Date().toISOString(),
          user: req.nickname
        };
        tab.auditLog.push(entry);
        if (tab.auditLog.length > LIMITS.MAX_AUDIT_ENTRIES) {
          tab.auditLog = tab.auditLog.slice(-LIMITS.MAX_AUDIT_ENTRIES);
        }
      });
      if (notFound) return res.status(404).json({ error: 'Tab not found' });

      broadcastToRoom(req.roomId, {
        type: 'audit-logged',
        tabId: req.params.tabId,
        entry
      }, req.token);

      res.json({ ok: true, entry });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/tabs/:tabId/audit
  router.delete('/tabs/:tabId/audit', requireRoom, validateTabId, async (req, res) => {
    try {
      let notFound = false;
      await storage.atomicUpdateRoomTabs(req.roomId, (data) => {
        const tab = data.tabs.find(t => t.id === req.params.tabId);
        if (!tab) { notFound = true; return false; }
        tab.auditLog = [];
      });
      if (notFound) return res.status(404).json({ error: 'Tab not found' });

      broadcastToRoom(req.roomId, {
        type: 'audit-cleared',
        tabId: req.params.tabId
      }, req.token);

      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
