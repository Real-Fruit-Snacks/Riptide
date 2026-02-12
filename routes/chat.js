'use strict';
const crypto = require('crypto');
const express = require('express');

module.exports = function(ctx) {
  const router = express.Router();
  const { storage, LIMITS, requireRoom, broadcastToRoom } = ctx;

  router.get('/chat', requireRoom, async (req, res) => {
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
        const data = await storage.readRoomTabs(req.roomId);
        if (!data || !data.tabs.find(t => t.id === tabId)) {
          return res.status(404).json({ error: 'Tab not found' });
        }
      }

      const messages = await storage.readChat(req.roomId, scope === 'tab' ? tabId : null);
      res.json(messages);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/chat', requireRoom, async (req, res) => {
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
      if (text.length > LIMITS.MAX_CHAT_MESSAGE_LENGTH) {
        return res.status(400).json({ error: 'Message text too long' });
      }

      if (scope === 'tab') {
        const data = await storage.readRoomTabs(req.roomId);
        if (!data || !data.tabs.find(t => t.id === tabId)) {
          return res.status(404).json({ error: 'Tab not found' });
        }
      }

      const effectiveTabId = scope === 'tab' ? tabId : null;
      const entry = {
        id: crypto.randomBytes(8).toString('hex'),
        text: text.trim(),
        user: req.nickname,
        timestamp: new Date().toISOString()
      };

      await storage.atomicUpdateChat(req.roomId, effectiveTabId, (messages) => {
        if (messages.length >= LIMITS.MAX_CHAT_MESSAGES) {
          messages.shift();
        }
        messages.push(entry);
        return entry;
      });

      broadcastToRoom(req.roomId, {
        type: 'chat-message',
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

  router.delete('/chat', requireRoom, async (req, res) => {
    try {
      const { scope, tabId } = req.query;

      if (!scope || (scope !== 'global' && scope !== 'tab')) {
        return res.status(400).json({ error: 'scope must be "global" or "tab"' });
      }

      if (scope === 'tab' && !tabId) {
        return res.status(400).json({ error: 'tabId is required for tab scope' });
      }

      if (scope === 'tab') {
        const data = await storage.readRoomTabs(req.roomId);
        if (!data || !data.tabs.find(t => t.id === tabId)) {
          return res.status(404).json({ error: 'Tab not found' });
        }
      }

      const effectiveTabId = scope === 'tab' ? tabId : null;
      await storage.atomicUpdateChat(req.roomId, effectiveTabId, (messages) => {
        messages.length = 0;
        return null;
      });

      broadcastToRoom(req.roomId, {
        type: 'chat-cleared',
        scope,
        tabId: scope === 'tab' ? tabId : undefined
      }, req.token);

      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
