'use strict';
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fsp = require('fs').promises;
const { hashToken } = require('../lib/helpers');

module.exports = function(ctx) {
  const router = express.Router();
  const {
    storage, requireRoom, broadcastToRoom, authLimiter,
    sessions, editLocks, ptyProcesses, roomClients,
    roomPtyKeys, roomLockKeys, roomSessionTokens,
    hashPassword, verifyPassword, createSession,
    getRoomUserCount, ALLOWED_WORKDIR_BASE, AdmZip
  } = ctx;

  // GET /api/rooms
  router.get('/rooms', async (_req, res) => {
    try {
      const data = await storage.readRooms();
      const rooms = data.rooms.map(r => ({
        id: r.id,
        name: r.name,
        userCount: getRoomUserCount(r.id),
        created: r.created
      }));
      res.json(rooms);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/rooms
  router.post('/rooms', authLimiter, async (req, res) => {
    try {
      const { name, password, nickname } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Room name is required' });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      if (password.length > 128) {
        return res.status(400).json({ error: 'Password must be 128 characters or fewer' });
      }
      if (!nickname || !nickname.trim()) {
        return res.status(400).json({ error: 'Nickname is required' });
      }
      if (name.trim().length > 64) {
        return res.status(400).json({ error: 'Room name must be 64 characters or fewer' });
      }
      if (nickname.trim().length > 32) {
        return res.status(400).json({ error: 'Nickname must be 32 characters or fewer' });
      }

      const workDir = req.body.workDir ? req.body.workDir.trim() : null;

      // Validate and create workDir if provided
      if (workDir) {
        if (workDir.length > 512) {
          return res.status(400).json({ error: 'Work directory path too long' });
        }
        // Must be absolute path
        if (!path.isAbsolute(workDir)) {
          return res.status(400).json({ error: 'Work directory must be an absolute path' });
        }
        // Prevent path traversal
        const resolved = path.resolve(workDir);
        if (resolved !== workDir) {
          return res.status(400).json({ error: 'Work directory path contains invalid sequences' });
        }
        // Restrict to allowed base directory if configured
        if (ALLOWED_WORKDIR_BASE) {
          const resolvedBase = path.resolve(ALLOWED_WORKDIR_BASE);
          if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
            return res.status(400).json({ error: 'Work directory must be within the allowed base directory: ' + resolvedBase });
          }
        }
        try {
          await fsp.mkdir(workDir, { recursive: true });
        } catch (dirErr) {
          return res.status(400).json({ error: 'Cannot create work directory: ' + dirErr.message });
        }
      }

      const roomId = crypto.randomBytes(8).toString('hex');
      const token = createSession(roomId, nickname.trim());
      const room = {
        id: roomId,
        name: name.trim(),
        passwordHash: await hashPassword(password),
        created: new Date().toISOString(),
        workDir: workDir || null,
        creator: nickname.trim(),
        creatorTokenHash: hashToken(token)
      };

      await storage.atomicUpdateRooms((data) => {
        data.rooms.push(room);
      });

      await storage.initRoom(roomId);

      res.status(201).json({
        token,
        room: { id: roomId, name: room.name, workDir: room.workDir },
        nickname: nickname.trim()
      });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/rooms/:id/join
  router.post('/rooms/:id/join', authLimiter, async (req, res) => {
    try {
      if (!/^[a-f0-9]{8,16}$/.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid room ID' });
      }
      const { password, nickname } = req.body;
      if (!password) {
        return res.status(400).json({ error: 'Password is required' });
      }
      if (!nickname || !nickname.trim()) {
        return res.status(400).json({ error: 'Nickname is required' });
      }
      if (nickname.trim().length > 32) {
        return res.status(400).json({ error: 'Nickname must be 32 characters or fewer' });
      }

      const data = await storage.readRooms();
      const room = data.rooms.find(r => r.id === req.params.id);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }

      if (!await verifyPassword(password, room.passwordHash)) {
        return res.status(403).json({ error: 'Wrong password' });
      }

      const token = createSession(room.id, nickname.trim());
      res.json({
        token,
        room: { id: room.id, name: room.name },
        nickname: nickname.trim()
      });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/rooms/validate
  router.get('/rooms/validate', requireRoom, async (req, res) => {
    try {
      const data = await storage.readRooms();
      const room = data.rooms.find(r => r.id === req.roomId);
      if (!room) {
        return res.status(404).json({ error: 'Room no longer exists' });
      }
      res.json({
        room: { id: room.id, name: room.name, workDir: room.workDir || null },
        nickname: req.nickname
      });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/rooms/:id/leave
  router.post('/rooms/:id/leave', requireRoom, (req, res) => {
    if (!/^[a-f0-9]{8,16}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid room ID' });
    }
    // Close sync WebSocket connections for this token
    const clients = roomClients.get(req.roomId);
    if (clients) {
      for (const client of [...clients]) {
        if (client.token === req.token) {
          clients.delete(client);
          if (client.ws.readyState === 1) client.ws.close();
        }
      }
    }
    sessions.delete(req.token);
    // Maintain secondary index
    roomSessionTokens.get(req.roomId)?.delete(req.token);
    res.json({ ok: true });
  });

  // GET /api/rooms/:id/export
  router.get('/rooms/:id/export', requireRoom, async (req, res) => {
    try {
      const roomDataDir = await storage.resolveRoomDataDir(req.roomId);
      if (!await storage.fileExists(roomDataDir)) {
        return res.status(404).json({ error: 'No room data found' });
      }

      const zip = new AdmZip();

      // Recursively add all files from room data dir
      const addDirToZip = async (dirPath, zipPath) => {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const entryZipPath = zipPath ? zipPath + '/' + entry.name : entry.name;
          if (entry.isDirectory()) {
            await addDirToZip(fullPath, entryZipPath);
          } else {
            const content = await fsp.readFile(fullPath);
            zip.addFile(entryZipPath, content);
          }
        }
      };

      await addDirToZip(roomDataDir, '');

      const zipBuffer = zip.toBuffer();
      const roomData = await storage.readRooms();
      const room = roomData.rooms.find(r => r.id === req.roomId);
      const safeName = storage.sanitizeForFilesystem(room ? room.name : req.roomId);

      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeName}-export.zip"`,
        'Content-Length': zipBuffer.length
      });
      res.send(zipBuffer);
    } catch (err) {
      console.error('Export error:', err);
      res.status(500).json({ error: 'Failed to export room data' });
    }
  });

  // POST /api/rooms/:id/import
  router.post('/rooms/:id/import', requireRoom, express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
    try {
      if (!req.body || !req.body.length) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const zip = new AdmZip(req.body);
      const roomDataDir = await storage.resolveRoomDataDir(req.roomId);

      // Zip-slip protection: validate all entry paths
      const entries = zip.getEntries();
      const resolvedTarget = path.resolve(roomDataDir);
      for (const entry of entries) {
        const entryPath = path.resolve(roomDataDir, entry.entryName);
        if (!entryPath.startsWith(resolvedTarget + path.sep) && entryPath !== resolvedTarget) {
          return res.status(400).json({ error: 'Invalid zip: path traversal detected' });
        }
      }

      await fsp.mkdir(roomDataDir, { recursive: true });
      zip.extractAllTo(roomDataDir, true);

      // Clear workDir cache so new data is picked up
      storage.roomWorkDirCache.clear();

      res.json({ ok: true });
    } catch (err) {
      console.error('Import error:', err);
      res.status(500).json({ error: 'Failed to import room data' });
    }
  });

  // GET /api/rooms/:id/report
  router.get('/rooms/:id/report', requireRoom, async (req, res) => {
    try {
      const includeCredentials = req.query.includeCredentials !== 'false';

      const data = await storage.readRooms();
      const room = data.rooms.find(r => r.id === req.roomId);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }

      // Helper to format timestamps
      function formatTimestamp(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
      }

      // Helper to escape pipe characters in table cells
      function escapeCell(value) {
        if (!value) return '';
        return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
      }

      // Helper to format file size
      function formatSize(size) {
        if (size < 1024) return size + ' B';
        if (size < 1048576) return (size / 1024).toFixed(1) + ' KB';
        return (size / 1048576).toFixed(1) + ' MB';
      }

      // Collect all data in parallel
      const [tabsData, globalCreds, globalNotes, alerts] = await Promise.all([
        storage.readRoomTabs(req.roomId),
        storage.readGlobalCredentials(req.roomId),
        storage.readScratchNotes(req.roomId, null),
        storage.readAlerts(req.roomId)
      ]);

      // Count totals
      let totalNotes = 0;
      let totalCreds = globalCreds.length;
      let totalCommands = 0;
      let totalAudit = 0;
      let totalScratch = globalNotes.length;
      let totalFiles = 0;

      // Build markdown report
      let md = `# Engagement Report: ${room.name}\n`;
      md += `**Generated:** ${formatTimestamp(new Date().toISOString())}  \n`;
      md += `**Room ID:** ${req.roomId}\n\n`;
      md += `---\n\n`;

      // Collect tab-specific data for summary
      const tabData = [];
      if (tabsData && tabsData.tabs) {
        for (const tab of tabsData.tabs) {
          try {
            const tabDir = await storage.resolveTabDataDir(req.roomId, tab.id);

            // Read playbook notes
            const notes = [];
            if (await storage.fileExists(tabDir)) {
              const files = await fsp.readdir(tabDir);
              const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('_'));
              for (const mdFile of mdFiles) {
                const content = await fsp.readFile(path.join(tabDir, mdFile), 'utf-8');
                notes.push({ filename: mdFile, content });
              }
            }
            totalNotes += notes.length;

            // Read credentials and scratch notes in parallel
            const [creds, scratchNotes] = await Promise.all([
              storage.readCredentials(req.roomId, tab.id),
              storage.readScratchNotes(req.roomId, tab.id)
            ]);
            totalCreds += creds.length;
            totalScratch += scratchNotes.length;

            // Read files
            const filesDir = path.join(tabDir, 'files');
            const files = [];
            if (await storage.fileExists(filesDir)) {
              const fileEntries = await fsp.readdir(filesDir, { withFileTypes: true });
              for (const entry of fileEntries) {
                if (entry.isFile()) {
                  const stats = await fsp.stat(path.join(filesDir, entry.name));
                  files.push({ name: entry.name, size: stats.size, uploadedBy: 'unknown', date: stats.mtime });
                }
              }
            }
            totalFiles += files.length;

            totalCommands += (tab.commandHistory || []).length;
            totalAudit += (tab.auditLog || []).length;

            tabData.push({ tab, notes, creds, scratchNotes, files });
          } catch (err) {
            console.error(`Error collecting data for tab ${tab.id}:`, err);
            tabData.push({ tab, notes: [], creds: [], scratchNotes: [], files: [] });
          }
        }
      }

      // Executive Summary
      md += `## Executive Summary\n`;
      md += `| Metric | Count |\n`;
      md += `|--------|-------|\n`;
      md += `| Tabs | ${tabsData?.tabs.length || 0} |\n`;
      md += `| Playbook Notes | ${totalNotes} |\n`;
      md += `| Credentials Found | ${totalCreds} |\n`;
      md += `| Commands Executed | ${totalCommands} |\n`;
      md += `| Audit Log Entries | ${totalAudit} |\n`;
      md += `| Scratch Notes | ${totalScratch} |\n`;
      md += `| Findings Flagged | ${alerts.length} |\n`;
      md += `| Files Collected | ${totalFiles} |\n\n`;
      md += `---\n\n`;

      // Global Credentials
      if (includeCredentials && globalCreds.length > 0) {
        md += `## Global Credentials\n`;
        md += `| Service | Host | Username | Password | Notes | Added By |\n`;
        md += `|---------|------|----------|----------|-------|----------|\n`;
        for (const cred of globalCreds) {
          md += `| ${escapeCell(cred.service)} | ${escapeCell(cred.host)} | ${escapeCell(cred.username)} | ${escapeCell(cred.password)} | ${escapeCell(cred.notes)} | ${escapeCell(cred.addedBy)} |\n`;
        }
        md += `\n`;
      }

      // Global Scratch Notes
      if (globalNotes.length > 0) {
        md += `## Global Scratch Notes\n`;
        md += `| Time | Severity | User | Note |\n`;
        md += `|------|----------|------|------|\n`;
        for (const note of globalNotes) {
          md += `| ${formatTimestamp(note.timestamp)} | ${escapeCell(note.severity)} | ${escapeCell(note.user)} | ${escapeCell(note.text)} |\n`;
        }
        md += `\n`;
      }

      // Alerts / Flagged Findings
      if (alerts.length > 0) {
        md += `## Alerts / Flagged Findings\n`;
        md += `| Time | Context | Title | Flagged By | Preview |\n`;
        md += `|------|---------|-------|------------|--------|\n`;
        for (const alert of alerts) {
          md += `| ${formatTimestamp(alert.timestamp)} | ${escapeCell(alert.context)} | ${escapeCell(alert.title)} | ${escapeCell(alert.nickname)} | ${escapeCell(alert.preview)} |\n`;
        }
        md += `\n`;
      }

      md += `---\n\n`;

      // Tab sections
      for (const { tab, notes, creds, scratchNotes, files } of tabData) {
        const status = tab.status ? `[${tab.status.toUpperCase()}]` : '[ACTIVE]';
        md += `## Tab: ${tab.name} ${status}\n\n`;

        // Playbook Notes
        if (notes.length > 0) {
          md += `### Playbook Notes\n`;
          for (const note of notes) {
            const title = note.filename.replace(/\.md$/, '');
            md += `#### ${title}\n`;
            md += `${note.content}\n\n`;
            md += `---\n\n`;
          }
        }

        // Credentials Discovered
        if (includeCredentials && creds.length > 0) {
          md += `### Credentials Discovered\n`;
          md += `| Service | Host | Username | Password | Notes | Added By |\n`;
          md += `|---------|------|----------|----------|-------|----------|\n`;
          for (const cred of creds) {
            md += `| ${escapeCell(cred.service)} | ${escapeCell(cred.host)} | ${escapeCell(cred.username)} | ${escapeCell(cred.password)} | ${escapeCell(cred.notes)} | ${escapeCell(cred.addedBy)} |\n`;
          }
          md += `\n`;
        } else if (!includeCredentials && creds.length > 0) {
          md += `### Credentials Discovered\n`;
          md += `| Service | Host | Username | Password | Notes | Added By |\n`;
          md += `|---------|------|----------|----------|-------|----------|\n`;
          for (const cred of creds) {
            md += `| ${escapeCell(cred.service)} | ${escapeCell(cred.host)} | ${escapeCell(cred.username)} | [REDACTED] | ${escapeCell(cred.notes)} | ${escapeCell(cred.addedBy)} |\n`;
          }
          md += `\n`;
        }

        // Command History
        if (tab.commandHistory && tab.commandHistory.length > 0) {
          md += `### Command History\n`;
          md += `| Time | User | Command |\n`;
          md += `|------|------|--------|\n`;
          for (const entry of tab.commandHistory) {
            md += `| ${formatTimestamp(entry.timestamp)} | ${escapeCell(entry.user)} | ${escapeCell(entry.command)} |\n`;
          }
          md += `\n`;
        }

        // Scratch Notes
        if (scratchNotes.length > 0) {
          md += `### Scratch Notes\n`;
          md += `| Time | Severity | User | Note |\n`;
          md += `|------|----------|------|------|\n`;
          for (const note of scratchNotes) {
            md += `| ${formatTimestamp(note.timestamp)} | ${escapeCell(note.severity)} | ${escapeCell(note.user)} | ${escapeCell(note.text)} |\n`;
          }
          md += `\n`;
        }

        // Audit Trail
        if (tab.auditLog && tab.auditLog.length > 0) {
          md += `### Audit Trail\n`;
          md += `| Time | User | Playbook | Command | Type |\n`;
          md += `|------|------|----------|---------|------|\n`;
          for (const entry of tab.auditLog) {
            md += `| ${formatTimestamp(entry.timestamp)} | ${escapeCell(entry.user)} | ${escapeCell(entry.playbook)} | ${escapeCell(entry.command)} | ${escapeCell(entry.type)} |\n`;
          }
          md += `\n`;
        }

        // Files
        if (files.length > 0) {
          md += `### Files\n`;
          md += `| Name | Size | Uploaded By | Date |\n`;
          md += `|------|------|-------------|------|\n`;
          for (const file of files) {
            md += `| ${escapeCell(file.name)} | ${formatSize(file.size)} | ${escapeCell(file.uploadedBy)} | ${formatTimestamp(file.date)} |\n`;
          }
          md += `\n`;
        }

        md += `\n`;
      }

      const sanitizedName = (room.name || 'engagement').replace(/[^a-zA-Z0-9_-]/g, '_');
      const dateStr = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="report-${sanitizedName}-${dateStr}.md"`);
      res.send(md);
    } catch (err) {
      console.error('Report generation error:', err);
      res.status(500).json({ error: 'Failed to generate report' });
    }
  });

  // PATCH /api/rooms/:id/password
  router.patch('/rooms/:id/password', authLimiter, requireRoom, async (req, res) => {
    try {
      if (!/^[a-f0-9]{8,16}$/.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid room ID' });
      }
      if (req.roomId !== req.params.id) {
        return res.status(403).json({ error: 'Can only manage your current room' });
      }

      const { currentPassword, newPassword } = req.body;

      // Validate inputs
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Both currentPassword and newPassword are required' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      if (newPassword.length > 128) {
        return res.status(400).json({ error: 'New password must be 128 characters or fewer' });
      }

      // Verify creator and current password
      const data = await storage.readRooms();
      const room = data.rooms.find(r => r.id === req.params.id);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }

      // Check creator authorization
      const tokenHash = hashToken(req.token);
      const isCreator = room.creatorTokenHash
        ? room.creatorTokenHash === tokenHash
        : room.creator === req.nickname;

      if (!isCreator) {
        return res.status(403).json({ error: 'Only room creator can change password' });
      }

      // Verify current password
      const passwordValid = await verifyPassword(currentPassword, room.passwordHash);
      if (!passwordValid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      // Hash new password and update room
      const newPasswordHash = await hashPassword(newPassword);
      await storage.atomicUpdateRooms((roomsData) => {
        const r = roomsData.rooms.find(rm => rm.id === req.params.id);
        if (!r) return false;
        r.passwordHash = newPasswordHash;
        r.creatorTokenHash = tokenHash;
        return true;
      });

      // Invalidate all sessions for this room
      const roomTokens = roomSessionTokens.get(req.roomId);
      if (roomTokens) {
        for (const sessionToken of roomTokens) {
          sessions.delete(sessionToken);
        }
        roomSessionTokens.delete(req.roomId);
      }

      // Close all sync WebSocket connections for this room
      const clients = roomClients.get(req.roomId);
      if (clients) {
        for (const ws of clients) {
          ws.close();
        }
        roomClients.delete(req.roomId);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('Password change error:', err);
      res.status(500).json({ error: 'Failed to change password' });
    }
  });

  // PATCH /api/rooms/:id
  router.patch('/rooms/:id', requireRoom, async (req, res) => {
    try {
      if (!/^[a-f0-9]{8,16}$/.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid room ID' });
      }
      if (req.roomId !== req.params.id) {
        return res.status(403).json({ error: 'Can only manage your current room' });
      }
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }

      let newName;
      const result = await storage.atomicUpdateRooms((data) => {
        const room = data.rooms.find(r => r.id === req.params.id);
        if (!room) return false;
        room.name = name.trim();
        newName = room.name;
        return true;
      });

      if (result === false) {
        return res.status(404).json({ error: 'Room not found' });
      }

      broadcastToRoom(req.roomId, {
        type: 'room-renamed',
        name: newName,
        user: req.nickname
      }, req.token);

      res.json({ ok: true, name: newName });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/rooms/:id
  router.delete('/rooms/:id', requireRoom, async (req, res) => {
    try {
      if (!/^[a-f0-9]{8,16}$/.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid room ID' });
      }
      if (req.roomId !== req.params.id) {
        return res.status(403).json({ error: 'Can only manage your current room' });
      }

      const data = await storage.readRooms();
      const room = data.rooms.find(r => r.id === req.params.id);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }
      if (room.creatorTokenHash) {
        if (hashToken(req.token) !== room.creatorTokenHash) {
          return res.status(403).json({ error: 'Only the room creator can delete the room' });
        }
      } else if (room.creator && room.creator !== req.nickname) {
        // Legacy fallback for rooms created before token-based auth
        return res.status(403).json({ error: 'Only the room creator can delete the room' });
      }

      const roomId = req.params.id;

      // Broadcast room-deleted to all clients (including sender)
      broadcastToRoom(roomId, { type: 'room-deleted', user: req.nickname });

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

      // Clean up edit locks for this room using secondary index
      const lockKeys = roomLockKeys.get(roomId);
      if (lockKeys) {
        for (const key of lockKeys) {
          editLocks.delete(key);
        }
        roomLockKeys.delete(roomId);
      }

      // Close all sync WebSocket connections for this room
      const clients = roomClients.get(roomId);
      if (clients) {
        for (const client of clients) {
          if (client.ws.readyState === 1) client.ws.close();
        }
        roomClients.delete(roomId);
      }

      // Invalidate all sessions for this room using secondary index
      const tokens = roomSessionTokens.get(roomId);
      if (tokens) {
        for (const token of tokens) {
          sessions.delete(token);
        }
        roomSessionTokens.delete(roomId);
      }

      // Atomically remove room from rooms.json
      let spliceNotFound = false;
      await storage.atomicUpdateRooms((freshData) => {
        const idx = freshData.rooms.findIndex(r => r.id === roomId);
        if (idx === -1) { spliceNotFound = true; return false; }
        freshData.rooms.splice(idx, 1);
      });
      if (spliceNotFound) return res.status(404).json({ error: 'Room already deleted' });

      // Remove room directory from disk
      const roomDir = storage.getRoomDir(roomId);
      if (await storage.fileExists(roomDir)) {
        await fsp.rm(roomDir, { recursive: true, force: true });
      }

      // Clean up workDir if it exists and is separate from roomDir
      if (room.workDir) {
        try {
          if (await storage.fileExists(room.workDir)) {
            await fsp.rm(room.workDir, { recursive: true, force: true });
          }
        } catch (wdErr) {
          console.warn('Warning: Could not clean up workDir:', room.workDir, wdErr.message);
        }
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
