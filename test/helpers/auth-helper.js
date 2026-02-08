'use strict';

const crypto = require('crypto');

/**
 * Create a test session and register it in the sessions Map + secondary index.
 *
 * @param {Map} sessions         - token -> { roomId, nickname, connectedAt }
 * @param {Map} roomSessionTokens - roomId -> Set<token>
 * @param {string} roomId
 * @param {string} nickname
 * @returns {string} token
 */
function createTestSession(sessions, roomSessionTokens, roomId, nickname) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { roomId, nickname, connectedAt: Date.now() });
  if (!roomSessionTokens.has(roomId)) roomSessionTokens.set(roomId, new Set());
  roomSessionTokens.get(roomId).add(token);
  return token;
}

/**
 * Create an expired session (for testing expiry logic).
 */
function createExpiredSession(sessions, roomSessionTokens, roomId, nickname) {
  const token = crypto.randomBytes(24).toString('hex');
  // connectedAt 25 hours ago (past the 24h TTL)
  sessions.set(token, { roomId, nickname, connectedAt: Date.now() - 25 * 60 * 60 * 1000 });
  if (!roomSessionTokens.has(roomId)) roomSessionTokens.set(roomId, new Set());
  roomSessionTokens.get(roomId).add(token);
  return token;
}

module.exports = {
  createTestSession,
  createExpiredSession
};
