'use strict';
const express = require('express');
const crypto = require('crypto');

module.exports = function(ctx) {
  const router = express.Router();
  const {
    storage, LIMITS, requireRoom, broadcastToRoom,
    validateTabId
  } = ctx;

  // GET /api/tabs/:tabId/history
  router.get('/tabs/:tabId/history', requireRoom, validateTabId, async (req, res) => {
    try {
      const data = await storage.readRoomTabs(req.roomId);
      const tab = data.tabs.find(t => t.id === req.params.tabId);
      if (!tab) {
        return res.status(404).json({ error: 'Tab not found' });
      }
      res.json(tab.commandHistory || []);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/tabs/:tabId/history
  router.post('/tabs/:tabId/history', requireRoom, validateTabId, async (req, res) => {
    try {
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ error: 'command is required' });
      }
      if (typeof command !== 'string' || command.length > LIMITS.MAX_COMMAND_LENGTH) {
        return res.status(400).json({ error: 'Command too long' });
      }

      let notFound = false;
      let duplicate = null;
      let entry = null;
      await storage.atomicUpdateRoomTabs(req.roomId, (data) => {
        const tab = data.tabs.find(t => t.id === req.params.tabId);
        if (!tab) {
          notFound = true;
          return false;
        }

        if (!tab.commandHistory) tab.commandHistory = [];

        // Skip if last entry is the same command (dedup consecutive)
        const lastEntry = tab.commandHistory[tab.commandHistory.length - 1];
        if (lastEntry && lastEntry.command === command) {
          duplicate = lastEntry;
          return false;
        }

        entry = {
          id: crypto.randomBytes(8).toString('hex'),
          command,
          timestamp: new Date().toISOString(),
          user: req.nickname
        };

        tab.commandHistory.push(entry);

        // Cap command history
        if (tab.commandHistory.length > LIMITS.MAX_HISTORY_ENTRIES) {
          tab.commandHistory = tab.commandHistory.slice(-LIMITS.MAX_HISTORY_ENTRIES);
        }
      });
      if (notFound) return res.status(404).json({ error: 'Tab not found' });
      if (duplicate) return res.json({ ok: true, entry: duplicate, duplicate: true });

      broadcastToRoom(req.roomId, {
        type: 'command-logged',
        tabId: req.params.tabId,
        entry
      }, req.token);

      res.json({ ok: true, entry });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/tabs/:tabId/history
  router.delete('/tabs/:tabId/history', requireRoom, validateTabId, async (req, res) => {
    try {
      let notFound = false;
      await storage.atomicUpdateRoomTabs(req.roomId, (data) => {
        const tab = data.tabs.find(t => t.id === req.params.tabId);
        if (!tab) {
          notFound = true;
          return false;
        }
        tab.commandHistory = [];
      });
      if (notFound) return res.status(404).json({ error: 'Tab not found' });

      broadcastToRoom(req.roomId, {
        type: 'history-cleared',
        tabId: req.params.tabId,
        user: req.nickname
      }, req.token);

      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
