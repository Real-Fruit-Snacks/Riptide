'use strict';
const express = require('express');

module.exports = function(ctx) {
  const router = express.Router();
  const { storage, requireRoom, broadcastToRoom } = ctx;

  router.get('/alerts', requireRoom, async (req, res) => {
    try {
      const alerts = await storage.readAlerts(req.roomId);
      res.json(alerts);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/alerts', requireRoom, async (req, res) => {
    try {
      await storage.writeAlerts(req.roomId, []);
      broadcastToRoom(req.roomId, { type: 'alerts-cleared' }, req.token);
      res.json({ ok: true });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
