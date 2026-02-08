'use strict';

const express = require('express');

/**
 * Create an Express app with a route module mounted for testing.
 *
 * Does NOT add requireRoom globally — each route handles its own middleware
 * via the routeCtx functions passed to the route factory.
 *
 * @param {Function} routeModule  - Route factory function (e.g. require('../../routes/notes'))
 * @param {Object}   routeCtx    - The mock routeCtx from createMockContext()
 * @param {Object}   [opts]      - Options
 * @param {string}   [opts.mountPath='/api'] - Mount path prefix
 * @returns {express.Application}
 */
function createTestApp(routeModule, routeCtx, opts = {}) {
  const app = express();
  const mountPath = opts.mountPath || '/api';

  // JSON body parser (matches server.js config)
  app.use(express.json({ limit: '256kb' }));

  // Mount the route module
  app.use(mountPath, routeModule(routeCtx));

  // Error handler (catches multer errors, body-parser limit errors, etc.)
  app.use((err, _req, res, _next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large' });
    }
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

/**
 * Create a test app with multiple route modules mounted (for cross-route testing).
 *
 * @param {Function[]} routeModules - Array of route factory functions
 * @param {Object}     routeCtx     - The mock routeCtx
 * @returns {express.Application}
 */
function createTestAppMulti(routeModules, routeCtx) {
  const app = express();

  app.use(express.json({ limit: '256kb' }));

  for (const mod of routeModules) {
    app.use('/api', mod(routeCtx));
  }

  app.use((err, _req, res, _next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large' });
    }
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = {
  createTestApp,
  createTestAppMulti
};
