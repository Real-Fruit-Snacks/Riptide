'use strict';
const express = require('express');

module.exports = function(ctx) {
  const router = express.Router();
  const { storage, requireRoom, broadcastToRoom } = ctx;

  router.get('/variables', requireRoom, async (req, res) => {
    try {
      const vars = await storage.readGlobalVariables(req.roomId);
      res.json(vars);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/variables', requireRoom, async (req, res) => {
    try {
      const { variables } = req.body;
      if (!variables || typeof variables !== 'object') {
        return res.status(400).json({ error: 'variables object required' });
      }
      if (Array.isArray(variables)) {
        return res.status(400).json({ error: 'variables must be a plain object' });
      }
      // Prevent prototype pollution
      const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
      for (const key of Object.keys(variables)) {
        if (dangerousKeys.includes(key)) {
          return res.status(400).json({ error: `Invalid variable name: ${key}` });
        }
      }

      let updatedVars;
      await storage.atomicUpdateGlobalVariables(req.roomId, (current) => {
        Object.assign(current, variables);
        updatedVars = { ...current };
        return true;
      });

      broadcastToRoom(req.roomId, {
        type: 'global-variables-changed',
        variables: updatedVars,
        user: req.nickname
      }, req.token);

      res.json({ ok: true, variables: updatedVars });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/variables/:name', requireRoom, async (req, res) => {
    try {
      const { name } = req.params;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return res.status(400).json({ error: 'Invalid variable name' });
      }

      let updatedVars;
      const result = await storage.atomicUpdateGlobalVariables(req.roomId, (current) => {
        if (!(name in current)) return false;
        delete current[name];
        updatedVars = { ...current };
        return true;
      });

      if (result === false) {
        return res.status(404).json({ error: 'Variable not found' });
      }

      broadcastToRoom(req.roomId, {
        type: 'global-variables-changed',
        variables: updatedVars,
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
