'use strict';
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fsp = require('fs').promises;

module.exports = function(ctx) {
  const router = express.Router();
  const {
    storage, LIMITS, requireRoom, broadcastToRoom,
    editLocks, ptyProcesses, roomPtyKeys, roomLockKeys
  } = ctx;

  // GET /api/tabs
  router.get('/tabs', requireRoom, async (req, res) => {
    try {
      let data = await storage.readRoomTabs(req.roomId);
      if (!data) {
        // Auto-initialize if tabs.json is missing (e.g. new workDir)
        await storage.initRoom(req.roomId);
        data = await storage.readRoomTabs(req.roomId);
      }
      if (!data) {
        return res.status(500).json({ error: 'No tab data for room' });
      }
      res.json(data);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/tabs
  router.post('/tabs', requireRoom, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      const id = crypto.randomBytes(8).toString('hex');
      const tab = { id, name: name.trim(), activeNoteId: null, variables: {}, commandHistory: [], status: null };

      await storage.atomicUpdateRoomTabs(req.roomId, (data) => {
        data.tabs.push(tab);
      });

      // Ensure data directory for this tab
      await storage.ensureTabDataDir(req.roomId, tab.id);

      broadcastToRoom(req.roomId, { type: 'tab-created', tab, user: req.nickname }, req.token);

      res.status(201).json(tab);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PATCH /api/tabs/:id
  router.patch('/tabs/:id', requireRoom, async (req, res) => {
    try {
      const { id } = req.params;
      if (!id || !/^[a-f0-9]{8,16}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid tab ID' });
      }
      let notFound = false;
      let invalidName = false;
      let invalidStatus = false;
      await storage.atomicUpdateRoomTabs(req.roomId, async (data) => {
        const tab = data.tabs.find(t => t.id === id);
        if (!tab) {
          notFound = true;
          return false;
        }
        if (req.body.name !== undefined) {
          const name = req.body.name;
          if (typeof name !== 'string' || name.trim().length === 0 || name.length > LIMITS.MAX_TAB_NAME) {
            invalidName = true;
            return false;
          }
          const oldName = tab.name;
          tab.name = name;

          // Rename data directory if workDir is set (dir is named after tab)
          const wd = await storage.getWorkDir(req.roomId);
          if (wd) {
            const oldDir = path.join(wd, storage.sanitizeForFilesystem(oldName));
            const newDir = path.join(wd, storage.sanitizeForFilesystem(tab.name));
            if (oldDir !== newDir) {
              try {
                await fsp.access(oldDir);
                await fsp.rename(oldDir, newDir);
              } catch (_renameErr) {
                // Check if old dir exists — if so, rename truly failed, revert name
                const oldDirExists = await storage.fileExists(oldDir);
                if (oldDirExists) {
                  tab.name = oldName;
                  invalidName = true;
                  return false;
                }
                // Old dir doesn't exist — create new one for fresh tab
                await fsp.mkdir(newDir, { recursive: true });
              }
            }
          }

          broadcastToRoom(req.roomId, {
            type: 'tab-renamed', tabId: id, name: name, user: req.nickname
          }, req.token);
        }
        if (req.body.activeNoteId !== undefined) tab.activeNoteId = req.body.activeNoteId;
        if (req.body.variables !== undefined) {
          // Prevent prototype pollution
          if (req.body.variables && typeof req.body.variables === 'object' && !Array.isArray(req.body.variables)) {
            const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
            for (const key of Object.keys(req.body.variables)) {
              if (dangerousKeys.includes(key)) {
                invalidStatus = true;
                return false;
              }
            }
          }
          tab.variables = req.body.variables;
          broadcastToRoom(req.roomId, {
            type: 'variables-changed', tabId: id, variables: req.body.variables, user: req.nickname
          }, req.token);
        }
        if (req.body.status !== undefined) {
          const validStatuses = [null, 'recon', 'exploit', 'post-exploit', 'pwned', 'blocked'];
          if (!validStatuses.includes(req.body.status)) {
            invalidStatus = true;
            return false;
          }
          tab.status = req.body.status;
          broadcastToRoom(req.roomId, {
            type: 'tab-status-changed', tabId: id, status: req.body.status, user: req.nickname
          }, req.token);
        }
        if (req.body.scope !== undefined) {
          if (req.body.scope !== null && (typeof req.body.scope !== 'string' || req.body.scope.length > 50)) {
            invalidStatus = true;
            return false;
          }
          tab.scope = req.body.scope;
          broadcastToRoom(req.roomId, {
            type: 'scope-changed', tabId: id, scope: req.body.scope, user: req.nickname
          }, req.token);
        }
      });
      if (notFound) return res.status(404).json({ error: 'Tab not found' });
      if (invalidName) return res.status(400).json({ error: 'Tab name must be 1-100 characters' });
      if (invalidStatus) return res.status(400).json({ error: 'Invalid status' });
      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/tabs/:id
  router.delete('/tabs/:id', requireRoom, async (req, res) => {
    try {
      const { id } = req.params;
      if (!id || !/^[a-f0-9]{8,16}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid tab ID' });
      }
      let lastTab = false;
      let notFound = false;
      await storage.atomicUpdateRoomTabs(req.roomId, (data) => {
        if (data.tabs.length <= 1) {
          lastTab = true;
          return false;
        }
        const tabIndex = data.tabs.findIndex(t => t.id === id);
        if (tabIndex === -1) {
          notFound = true;
          return false;
        }
        data.tabs.splice(tabIndex, 1);
        if (data.activeTabId === id) {
          data.activeTabId = data.tabs[0].id;
        }
      });
      if (lastTab) return res.status(400).json({ error: 'Cannot delete the last tab' });
      if (notFound) return res.status(404).json({ error: 'Tab not found' });

      // Clear all edit locks for notes in this tab using secondary index
      const lockPrefix = `${req.roomId}:${id}:`;
      const roomLocks = roomLockKeys.get(req.roomId);
      if (roomLocks) {
        for (const key of [...roomLocks]) {
          if (key.startsWith(lockPrefix)) {
            editLocks.delete(key);
            roomLocks.delete(key);
          }
        }
      }

      // Soft delete: keep tab data on disk for potential export/recovery
      // Only remove from tabs.json — filesystem data is preserved

      // Kill all PTY processes for this tab (all sub-tabs) using secondary index
      const ptyPrefix = req.roomId + ':' + id + ':';
      const roomPtys = roomPtyKeys.get(req.roomId);
      if (roomPtys) {
        for (const key of [...roomPtys]) {
          if (key.startsWith(ptyPrefix)) {
            const entry = ptyProcesses.get(key);
            if (entry) {
              entry.pty.kill();
              for (const client of entry.clients) {
                if (client.readyState === 1) client.close();
              }
              ptyProcesses.delete(key);
            }
            roomPtys.delete(key);
          }
        }
      }

      broadcastToRoom(req.roomId, { type: 'tab-deleted', tabId: id, user: req.nickname }, req.token);

      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
