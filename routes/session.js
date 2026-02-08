'use strict';
const express = require('express');
const crypto = require('crypto');
const fsp = require('fs').promises;
const { hashToken } = require('../lib/helpers');

module.exports = function(ctx) {
  const router = express.Router();
  const {
    storage, requireRoom, broadcastToRoom,
    ptyProcesses, roomPtyKeys
  } = ctx;

  // POST /api/session/reset
  router.post('/session/reset', requireRoom, async (req, res) => {
    try {
      const roomId = req.roomId;

      // Only the room creator can reset the session
      const rooms = await storage.readRooms();
      const room = rooms.rooms.find(r => r.id === roomId);
      if (room) {
        if (room.creatorTokenHash) {
          if (hashToken(req.token) !== room.creatorTokenHash) {
            return res.status(403).json({ error: 'Only the room creator can reset the session' });
          }
        } else if (room.creator && room.creator !== req.nickname) {
          // Legacy fallback for rooms created before token-based auth
          return res.status(403).json({ error: 'Only the room creator can reset the session' });
        }
      }

      // Kill all PTY processes for this room using secondary index
      const ptyKeys = roomPtyKeys.get(roomId);
      if (ptyKeys) {
        for (const key of ptyKeys) {
          const entry = ptyProcesses.get(key);
          if (entry) {
            entry.pty.kill();
            for (const client of entry.clients) {
              if (client.readyState === 1) client.close();
            }
            ptyProcesses.delete(key);
          }
        }
        roomPtyKeys.delete(roomId);
      }

      // Remove all tab data directories for this room
      const data = await storage.readRoomTabs(roomId);
      if (data) {
        for (const tab of data.tabs) {
          const tabDir = await storage.resolveTabDataDir(roomId, tab.id);
          if (await storage.fileExists(tabDir)) {
            await fsp.rm(tabDir, { recursive: true, force: true });
          }
        }
      }

      // Create fresh session
      const newId = crypto.randomBytes(8).toString('hex');
      const newData = {
        tabs: [{ id: newId, name: 'Main', activeNoteId: null, variables: {}, commandHistory: [], status: null }],
        activeTabId: newId
      };
      await storage.writeRoomTabs(roomId, newData);
      await storage.ensureTabDataDir(roomId, newId);

      broadcastToRoom(roomId, { type: 'session-reset', user: req.nickname }, req.token);

      res.json(newData);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
