'use strict';
const crypto = require('crypto');
const express = require('express');

module.exports = function(ctx) {
  const router = express.Router();
  const { storage, requireRoom, validateTabId, validateCredentialFields, broadcastToRoom } = ctx;

  // --- Tab Credentials ---

  router.get('/tabs/:tabId/credentials', requireRoom, validateTabId, async (req, res) => {
    try {
      const creds = await storage.readCredentials(req.roomId, req.params.tabId);
      res.json(creds);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/tabs/:tabId/credentials', requireRoom, validateTabId, async (req, res) => {
    try {
      const cred = validateCredentialFields(req, res, { requireAtLeastOne: true });
      if (!cred) return;

      const credential = {
        id: crypto.randomBytes(8).toString('hex'),
        service: cred.service,
        username: cred.username,
        password: cred.password,
        hash: cred.hash,
        notes: cred.notes,
        scope: 'tab',
        timestamp: new Date().toISOString(),
        user: req.nickname
      };

      await storage.atomicUpdateCredentials(req.roomId, req.params.tabId, (creds) => {
        creds.push(credential);
        return credential;
      });

      broadcastToRoom(req.roomId, {
        type: 'credential-created',
        tabId: req.params.tabId,
        credential
      }, req.token);

      res.json({ ok: true, credential });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.put('/tabs/:tabId/credentials/:credId', requireRoom, validateTabId, async (req, res) => {
    try {
      const { credId } = req.params;
      if (!/^[a-f0-9]{8,16}$/.test(credId)) {
        return res.status(400).json({ error: 'Invalid credential ID' });
      }

      const cred = validateCredentialFields(req, res);
      if (!cred) return;

      const result = await storage.atomicUpdateCredentials(req.roomId, req.params.tabId, (creds) => {
        const credential = creds.find(c => c.id === credId);
        if (!credential) return false;
        const { service, username, password, hash, notes } = req.body;
        if (service !== undefined) credential.service = service;
        if (username !== undefined) credential.username = username;
        if (password !== undefined) credential.password = password;
        if (hash !== undefined) credential.hash = hash;
        if (notes !== undefined) credential.notes = notes;
        credential.timestamp = new Date().toISOString();
        credential.user = req.nickname;
        return credential;
      });

      if (result === false) {
        return res.status(404).json({ error: 'Credential not found' });
      }

      broadcastToRoom(req.roomId, {
        type: 'credential-updated',
        tabId: req.params.tabId,
        credential: result
      }, req.token);

      res.json({ ok: true, credential: result });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/tabs/:tabId/credentials/:credId', requireRoom, validateTabId, async (req, res) => {
    try {
      const { credId } = req.params;
      if (!/^[a-f0-9]{8,16}$/.test(credId)) {
        return res.status(400).json({ error: 'Invalid credential ID' });
      }

      const result = await storage.atomicUpdateCredentials(req.roomId, req.params.tabId, (creds) => {
        const credIndex = creds.findIndex(c => c.id === credId);
        if (credIndex === -1) return false;
        creds.splice(credIndex, 1);
        return true;
      });

      if (result === false) {
        return res.status(404).json({ error: 'Credential not found' });
      }

      broadcastToRoom(req.roomId, {
        type: 'credential-deleted',
        tabId: req.params.tabId,
        credentialId: credId
      }, req.token);

      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/tabs/:tabId/credentials/export', requireRoom, validateTabId, async (req, res) => {
    try {
      const data = await storage.readRoomTabs(req.roomId);
      const tab = data.tabs.find(t => t.id === req.params.tabId);
      if (!tab) {
        return res.status(404).json({ error: 'Tab not found' });
      }

      const wd = await storage.getWorkDir(req.roomId);
      if (!wd) {
        return res.status(400).json({ error: 'No working directory configured for this room' });
      }
      const tabDir = await storage.ensureTabDataDir(req.roomId, req.params.tabId);

      const creds = await storage.readCredentials(req.roomId, req.params.tabId);
      if (creds.length === 0) {
        return res.status(400).json({ error: 'No credentials to export' });
      }

      const written = await storage.writeCredentialFiles(tabDir, null, creds);
      res.json({ ok: true, dir: tabDir, files: written });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Global Credentials ---

  router.get('/credentials', requireRoom, async (req, res) => {
    try {
      const creds = await storage.readGlobalCredentials(req.roomId);
      res.json(creds);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/credentials', requireRoom, async (req, res) => {
    try {
      const cred = validateCredentialFields(req, res, { requireAtLeastOne: true });
      if (!cred) return;

      const credential = {
        id: crypto.randomBytes(8).toString('hex'),
        service: cred.service,
        username: cred.username,
        password: cred.password,
        hash: cred.hash,
        notes: cred.notes,
        scope: 'global',
        timestamp: new Date().toISOString(),
        user: req.nickname
      };

      await storage.atomicUpdateGlobalCredentials(req.roomId, (creds) => {
        creds.push(credential);
        return credential;
      });

      broadcastToRoom(req.roomId, {
        type: 'global-credential-created',
        credential
      }, req.token);

      res.json({ ok: true, credential });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.put('/credentials/:credId', requireRoom, async (req, res) => {
    try {
      const { credId } = req.params;
      if (!/^[a-f0-9]{8,16}$/.test(credId)) {
        return res.status(400).json({ error: 'Invalid credential ID' });
      }

      const cred = validateCredentialFields(req, res);
      if (!cred) return;

      const result = await storage.atomicUpdateGlobalCredentials(req.roomId, (creds) => {
        const credential = creds.find(c => c.id === credId);
        if (!credential) return false;
        const { service, username, password, hash, notes } = req.body;
        if (service !== undefined) credential.service = service;
        if (username !== undefined) credential.username = username;
        if (password !== undefined) credential.password = password;
        if (hash !== undefined) credential.hash = hash;
        if (notes !== undefined) credential.notes = notes;
        credential.timestamp = new Date().toISOString();
        credential.user = req.nickname;
        return credential;
      });

      if (result === false) {
        return res.status(404).json({ error: 'Credential not found' });
      }

      broadcastToRoom(req.roomId, {
        type: 'global-credential-updated',
        credential: result
      }, req.token);

      res.json({ ok: true, credential: result });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/credentials/:credId', requireRoom, async (req, res) => {
    try {
      const { credId } = req.params;
      if (!/^[a-f0-9]{8,16}$/.test(credId)) {
        return res.status(400).json({ error: 'Invalid credential ID' });
      }

      const result = await storage.atomicUpdateGlobalCredentials(req.roomId, (creds) => {
        const credIndex = creds.findIndex(c => c.id === credId);
        if (credIndex === -1) return false;
        creds.splice(credIndex, 1);
        return true;
      });

      if (result === false) {
        return res.status(404).json({ error: 'Credential not found' });
      }

      broadcastToRoom(req.roomId, {
        type: 'global-credential-deleted',
        credentialId: credId
      }, req.token);

      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/credentials/export', requireRoom, async (req, res) => {
    try {
      const wd = await storage.getWorkDir(req.roomId);
      if (!wd) {
        return res.status(400).json({ error: 'No working directory configured for this room' });
      }
      const roomDir = await storage.resolveRoomDataDir(req.roomId);

      const creds = await storage.readGlobalCredentials(req.roomId);
      if (creds.length === 0) {
        return res.status(400).json({ error: 'No credentials to export' });
      }

      const written = await storage.writeCredentialFiles(roomDir, 'global', creds);
      res.json({ ok: true, dir: roomDir, files: written });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
