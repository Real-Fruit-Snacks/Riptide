'use strict';

const WebSocket = require('ws');
const { startTestServer } = require('../helpers/ws-server');

describe('WebSocket Sync (/ws/sync)', () => {
  let srv;
  const openSockets = [];

  /** Track sockets for cleanup */
  function track(ws) {
    openSockets.push(ws);
    return ws;
  }

  beforeAll(async () => {
    srv = await startTestServer();
  });

  afterEach(() => {
    // Close all tracked sockets after each test
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openSockets.length = 0;
    // Clear edit locks between tests
    srv.editLocks.clear();
    srv.roomLockKeys.clear();
  });

  afterAll(async () => {
    await srv.shutdown();
  });

  // ── Connection & Origin validation ────────────────────────────────

  describe('Connection & Origin validation', () => {
    it('connects with valid Origin header', async () => {
      const ws = track(await srv.connectSync());
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    it('rejects connection with no Origin header', async () => {
      await expect(srv.connectNoOrigin('/ws/sync')).rejects.toThrow();
    });

    it('rejects connection with mismatched Origin', async () => {
      await expect(
        srv.connectSync({ origin: 'http://evil.example.com' })
      ).rejects.toThrow();
    });

    it('destroys socket for unknown WebSocket path', async () => {
      await expect(srv.connectPath('/ws/unknown')).rejects.toThrow();
    });
  });

  // ── Authentication ────────────────────────────────────────────────

  describe('Authentication', () => {
    it('auth with valid token receives users list', async () => {
      const { token } = await srv.createRoom('AuthTest', 'alice');
      const ws = track(await srv.connectSync());

      const usersPromise = srv.waitForMessage(ws, 'users');
      ws.send(JSON.stringify({ type: 'auth', token }));

      const msg = await usersPromise;
      expect(msg.type).toBe('users');
      expect(Array.isArray(msg.users)).toBe(true);
      expect(msg.users.some(u => u.nickname === 'alice')).toBe(true);
    });

    it('auth with valid token receives existing edit-locks', async () => {
      const { roomId, token } = await srv.createRoom('LockTest', 'bob');

      // Pre-seed an edit lock
      const lockKey = `${roomId}:tab1:note1`;
      srv.editLocks.set(lockKey, { nickname: 'other', token: 'othertoken', lockedAt: Date.now() });
      if (!srv.roomLockKeys.has(roomId)) srv.roomLockKeys.set(roomId, new Set());
      srv.roomLockKeys.get(roomId).add(lockKey);

      const ws = track(await srv.connectSync());
      const msgs = srv.collectMessages(ws, 2);
      ws.send(JSON.stringify({ type: 'auth', token }));

      const collected = await msgs;
      const lockMsg = collected.find(m => m.type === 'edit-locks');
      expect(lockMsg).toBeDefined();
      expect(lockMsg.locks.length).toBe(1);
      expect(lockMsg.locks[0].tabId).toBe('tab1');
      expect(lockMsg.locks[0].noteId).toBe('note1');
      expect(lockMsg.locks[0].nickname).toBe('other');
    });

    it('auth with invalid token closes connection', async () => {
      const ws = track(await srv.connectSync());
      const closePromise = srv.waitForClose(ws);
      ws.send(JSON.stringify({ type: 'auth', token: 'invalid-token-value' }));
      await closePromise;
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('auth broadcasts user-joined to others', async () => {
      const { roomId, token: token1 } = await srv.createRoom('JoinTest', 'charlie');

      // First client authenticates
      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: token1 }));
      await srv.waitForMessage(ws1, 'users');

      // Second client connects — listen on ws1 for the join
      const token2 = srv.createSession(roomId, 'diana');
      const ws2 = track(await srv.connectSync());
      const joinPromise = srv.waitForMessage(ws1, 'user-joined');
      ws2.send(JSON.stringify({ type: 'auth', token: token2 }));

      const joined = await joinPromise;
      expect(joined.type).toBe('user-joined');
      expect(joined.nickname).toBe('diana');
    });
  });

  // ── Presence ──────────────────────────────────────────────────────

  describe('Presence', () => {
    it('user list updates when second user joins', async () => {
      const { roomId, token: token1 } = await srv.createRoom('PresenceTest', 'eve');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: token1 }));
      await srv.waitForMessage(ws1, 'users');

      // Second user joins and receives both users
      const token2 = srv.createSession(roomId, 'frank');
      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: token2 }));

      const usersMsg = await srv.waitForMessage(ws2, 'users');
      expect(usersMsg.users.length).toBe(2);
      const nicknames = usersMsg.users.map(u => u.nickname).sort();
      expect(nicknames).toEqual(['eve', 'frank']);
    });

    it('tab-switch broadcasts to other clients', async () => {
      const { roomId, token: token1 } = await srv.createRoom('TabSwitchTest', 'grace');
      const token2 = srv.createSession(roomId, 'heidi');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: token1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: token2 }));
      await srv.waitForMessage(ws2, 'users');

      // Wait for user-joined on ws1 so both are fully connected
      await srv.delay(100);

      // grace switches tab — heidi should see it
      const switchPromise = srv.waitForMessage(ws2, 'tab-switch');
      ws1.send(JSON.stringify({ type: 'tab-switch', tabId: 'newtab123' }));

      const switchMsg = await switchPromise;
      expect(switchMsg.nickname).toBe('grace');
      expect(switchMsg.tabId).toBe('newtab123');
    });

    it('user-left broadcast on disconnect', async () => {
      const { roomId, token: token1 } = await srv.createRoom('LeaveTest', 'ivan');
      const token2 = srv.createSession(roomId, 'judy');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: token1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: token2 }));
      await srv.waitForMessage(ws2, 'users');
      await srv.delay(100);

      // judy disconnects — ivan should see user-left
      const leftPromise = srv.waitForMessage(ws1, 'user-left');
      ws2.close();

      const leftMsg = await leftPromise;
      expect(leftMsg.type).toBe('user-left');
      expect(leftMsg.nickname).toBe('judy');
    });

    it('multiple users see each other in users list', async () => {
      const { roomId, token: t1 } = await srv.createRoom('MultiUser', 'u1');
      const t2 = srv.createSession(roomId, 'u2');
      const t3 = srv.createSession(roomId, 'u3');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: t1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: t2 }));
      await srv.waitForMessage(ws2, 'users');

      const ws3 = track(await srv.connectSync());
      ws3.send(JSON.stringify({ type: 'auth', token: t3 }));
      const usersMsg = await srv.waitForMessage(ws3, 'users');

      expect(usersMsg.users.length).toBe(3);
      const nicknames = usersMsg.users.map(u => u.nickname).sort();
      expect(nicknames).toEqual(['u1', 'u2', 'u3']);
    });
  });

  // ── Edit Locking ──────────────────────────────────────────────────

  describe('Edit Locking', () => {
    it('note-editing acquires lock and broadcasts', async () => {
      const { roomId, token: t1 } = await srv.createRoom('EditLock1', 'alice');
      const t2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: t1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: t2 }));
      await srv.waitForMessage(ws2, 'users');
      await srv.delay(100);

      // alice edits a note — bob should receive broadcast
      const editPromise = srv.waitForMessage(ws2, 'note-editing');
      ws1.send(JSON.stringify({ type: 'note-editing', tabId: 'tab1', noteId: 'note1' }));

      const editMsg = await editPromise;
      expect(editMsg.type).toBe('note-editing');
      expect(editMsg.tabId).toBe('tab1');
      expect(editMsg.noteId).toBe('note1');
      expect(editMsg.nickname).toBe('alice');

      // Verify lock is stored
      const lockKey = `${roomId}:tab1:note1`;
      expect(srv.editLocks.has(lockKey)).toBe(true);
      expect(srv.editLocks.get(lockKey).nickname).toBe('alice');
    });

    it('note-editing denied when locked by another (receives note-lock-denied)', async () => {
      const { roomId, token: t1 } = await srv.createRoom('LockDeny', 'alice');
      const t2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: t1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: t2 }));
      await srv.waitForMessage(ws2, 'users');
      await srv.delay(100);

      // alice acquires lock
      ws1.send(JSON.stringify({ type: 'note-editing', tabId: 'tab1', noteId: 'note1' }));
      await srv.waitForMessage(ws2, 'note-editing');

      // bob tries to acquire same lock — should be denied
      const deniedPromise = srv.waitForMessage(ws2, 'note-lock-denied');
      ws2.send(JSON.stringify({ type: 'note-editing', tabId: 'tab1', noteId: 'note1' }));

      const denied = await deniedPromise;
      expect(denied.type).toBe('note-lock-denied');
      expect(denied.noteId).toBe('note1');
      expect(denied.lockedBy).toBe('alice');
    });

    it('note-edit-done releases lock and broadcasts', async () => {
      const { roomId, token: t1 } = await srv.createRoom('EditDone', 'alice');
      const t2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: t1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: t2 }));
      await srv.waitForMessage(ws2, 'users');
      await srv.delay(100);

      // alice acquires and then releases lock
      ws1.send(JSON.stringify({ type: 'note-editing', tabId: 'tab1', noteId: 'note1' }));
      await srv.waitForMessage(ws2, 'note-editing');

      const donePromise = srv.waitForMessage(ws2, 'note-edit-done');
      ws1.send(JSON.stringify({ type: 'note-edit-done', tabId: 'tab1', noteId: 'note1' }));

      const doneMsg = await donePromise;
      expect(doneMsg.type).toBe('note-edit-done');
      expect(doneMsg.nickname).toBe('alice');

      // Verify lock is removed
      const lockKey = `${roomId}:tab1:note1`;
      expect(srv.editLocks.has(lockKey)).toBe(false);
    });

    it('note-edit-done only releases own lock', async () => {
      const { roomId, token: t1 } = await srv.createRoom('EditDoneOwn', 'alice');
      const t2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: t1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: t2 }));
      await srv.waitForMessage(ws2, 'users');
      await srv.delay(100);

      // alice acquires lock
      ws1.send(JSON.stringify({ type: 'note-editing', tabId: 'tab1', noteId: 'note1' }));
      await srv.waitForMessage(ws2, 'note-editing');

      // bob tries to release alice's lock — should have no effect
      ws2.send(JSON.stringify({ type: 'note-edit-done', tabId: 'tab1', noteId: 'note1' }));
      await srv.delay(200);

      // Lock should still be held by alice
      const lockKey = `${roomId}:tab1:note1`;
      expect(srv.editLocks.has(lockKey)).toBe(true);
      expect(srv.editLocks.get(lockKey).nickname).toBe('alice');
    });

    it('stale lock (expired TTL) is auto-released on new lock request', async () => {
      const { roomId, token: t1 } = await srv.createRoom('StaleLock', 'alice');
      const t2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: t1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: t2 }));
      await srv.waitForMessage(ws2, 'users');
      await srv.delay(100);

      // Manually insert an expired lock (lockedAt far in the past)
      const lockKey = `${roomId}:tab1:note1`;
      srv.editLocks.set(lockKey, {
        nickname: 'alice',
        token: t1,
        lockedAt: Date.now() - srv.LIMITS.EDIT_LOCK_TTL - 1000
      });

      // bob requests the same lock — should succeed (stale lock auto-released)
      const editPromise = srv.waitForMessage(ws1, 'note-editing');
      ws2.send(JSON.stringify({ type: 'note-editing', tabId: 'tab1', noteId: 'note1' }));

      const editMsg = await editPromise;
      expect(editMsg.nickname).toBe('bob');

      // Lock should now belong to bob
      expect(srv.editLocks.get(lockKey).nickname).toBe('bob');
    });

    it('all locks released on disconnect', async () => {
      const { roomId, token: t1 } = await srv.createRoom('DisconnLock', 'alice');
      const t2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: t1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: t2 }));
      await srv.waitForMessage(ws2, 'users');
      await srv.delay(100);

      // alice acquires two locks
      ws1.send(JSON.stringify({ type: 'note-editing', tabId: 'tab1', noteId: 'noteA' }));
      await srv.waitForMessage(ws2, 'note-editing');
      ws1.send(JSON.stringify({ type: 'note-editing', tabId: 'tab1', noteId: 'noteB' }));
      await srv.waitForMessage(ws2, 'note-editing');

      expect(srv.editLocks.size).toBeGreaterThanOrEqual(2);

      // alice disconnects — bob should receive note-edit-done for both
      const donePromise = srv.collectMessages(ws2, 2);
      ws1.close();

      const doneMsgs = await donePromise;
      const editDones = doneMsgs.filter(m => m.type === 'note-edit-done');
      expect(editDones.length).toBe(2);
      expect(editDones.every(m => m.nickname === 'alice')).toBe(true);

      // No locks should remain for alice
      const aliceLocks = [...srv.editLocks.values()].filter(l => l.nickname === 'alice');
      expect(aliceLocks.length).toBe(0);
    });
  });

  // ── Finding Flagged ───────────────────────────────────────────────

  describe('Finding Flagged', () => {
    it('finding-flagged persists alert to storage', async () => {
      const { roomId, token } = await srv.createRoom('FlagPersist', 'alice');

      const ws = track(await srv.connectSync());
      ws.send(JSON.stringify({ type: 'auth', token }));
      await srv.waitForMessage(ws, 'users');

      ws.send(JSON.stringify({
        type: 'finding-flagged',
        context: 'playbook',
        title: 'SQLi Found',
        preview: 'sqlmap output here'
      }));

      // Wait for async persistence
      await srv.delay(500);

      const alerts = await srv.storage.readAlerts(roomId);
      expect(alerts.length).toBe(1);
      expect(alerts[0].nickname).toBe('alice');
      expect(alerts[0].title).toBe('SQLi Found');
      expect(alerts[0].context).toBe('playbook');
      expect(alerts[0].preview).toBe('sqlmap output here');
      expect(alerts[0].id).toBeDefined();
      expect(alerts[0].timestamp).toBeDefined();
    });

    it('finding-flagged broadcasts to others (not sender)', async () => {
      const { roomId, token: t1 } = await srv.createRoom('FlagBroadcast', 'alice');
      const t2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: t1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: t2 }));
      await srv.waitForMessage(ws2, 'users');
      await srv.delay(100);

      // alice flags a finding — bob should receive it, alice should not
      const bobPromise = srv.waitForMessage(ws2, 'finding-flagged');

      ws1.send(JSON.stringify({
        type: 'finding-flagged',
        context: 'credential',
        title: 'Admin Creds',
        preview: 'admin:password'
      }));

      const flagMsg = await bobPromise;
      expect(flagMsg.type).toBe('finding-flagged');
      expect(flagMsg.nickname).toBe('alice');
      expect(flagMsg.title).toBe('Admin Creds');

      // alice should NOT receive this message — collect with short timeout
      const aliceMsgs = await srv.collectMessages(ws1, 1, 300);
      const aliceFlagged = aliceMsgs.filter(m => m.type === 'finding-flagged');
      expect(aliceFlagged.length).toBe(0);
    });

    it('finding-flagged sanitizes fields (truncates long strings)', async () => {
      const { roomId, token } = await srv.createRoom('FlagSanitize', 'alice');

      const ws = track(await srv.connectSync());
      ws.send(JSON.stringify({ type: 'auth', token }));
      await srv.waitForMessage(ws, 'users');

      const longContext = 'x'.repeat(500);
      const longTitle = 'y'.repeat(500);
      const longPreview = 'z'.repeat(500);

      ws.send(JSON.stringify({
        type: 'finding-flagged',
        context: longContext,
        title: longTitle,
        preview: longPreview
      }));

      await srv.delay(500);

      const alerts = await srv.storage.readAlerts(roomId);
      expect(alerts.length).toBe(1);
      expect(alerts[0].context.length).toBe(100);
      expect(alerts[0].title.length).toBe(200);
      expect(alerts[0].preview.length).toBe(200);
    });

    it('finding-flagged respects MAX_ALERTS cap', async () => {
      const { roomId, token } = await srv.createRoom('FlagCap', 'alice');

      // Pre-seed 200 alerts
      const existingAlerts = Array.from({ length: 200 }, (_, i) => ({
        id: `old-${i}`,
        timestamp: new Date().toISOString(),
        nickname: 'seed',
        context: 'test',
        title: `Alert ${i}`,
        preview: `preview ${i}`
      }));
      await srv.storage.writeAlerts(roomId, existingAlerts);

      const ws = track(await srv.connectSync());
      ws.send(JSON.stringify({ type: 'auth', token }));
      await srv.waitForMessage(ws, 'users');

      // Flag a new finding — should push out oldest
      ws.send(JSON.stringify({
        type: 'finding-flagged',
        context: 'playbook',
        title: 'New Alert',
        preview: 'new finding'
      }));

      await srv.delay(500);

      const alerts = await srv.storage.readAlerts(roomId);
      expect(alerts.length).toBe(200);
      // Oldest alert should be gone
      expect(alerts.find(a => a.id === 'old-0')).toBeUndefined();
      // New alert should be present
      expect(alerts.find(a => a.title === 'New Alert')).toBeDefined();
    });
  });

  // ── Rate Limiting & Size ──────────────────────────────────────────

  describe('Rate Limiting & Size', () => {
    it('messages over MAX_WS_MESSAGE_BYTES are silently dropped', async () => {
      const { roomId, token: t1 } = await srv.createRoom('SizeLimit', 'alice');
      const t2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: t1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: t2 }));
      await srv.waitForMessage(ws2, 'users');
      await srv.delay(100);

      // Send an oversized message — should be silently dropped
      const hugePayload = JSON.stringify({
        type: 'tab-switch',
        tabId: 'x'.repeat(srv.LIMITS.MAX_WS_MESSAGE_BYTES + 1)
      });
      ws1.send(hugePayload);

      // bob should not receive anything
      const msgs = await srv.collectMessages(ws2, 1, 500);
      const tabSwitches = msgs.filter(m => m.type === 'tab-switch');
      expect(tabSwitches.length).toBe(0);
    });

    it('messages over rate limit are silently dropped', async () => {
      const { roomId, token: t1 } = await srv.createRoom('RateLimit', 'alice');
      const t2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: t1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: t2 }));
      await srv.waitForMessage(ws2, 'users');
      await srv.delay(100);

      // Flood: send WS_RATE_LIMIT_PER_SEC + 20 messages rapidly
      const limit = srv.LIMITS.WS_RATE_LIMIT_PER_SEC;
      for (let i = 0; i < limit + 20; i++) {
        ws1.send(JSON.stringify({ type: 'tab-switch', tabId: `tab-${i}` }));
      }

      // Collect what bob receives — should be at most `limit` messages
      await srv.delay(500);
      const msgs = await srv.collectMessages(ws2, limit + 20, 500);
      const tabSwitches = msgs.filter(m => m.type === 'tab-switch');
      // Exactly `limit` messages minus the auth message should get through
      // (the first message increments counter to 1, so limit messages get through)
      expect(tabSwitches.length).toBeLessThanOrEqual(limit);
    });

    it('normal message flow within limits works fine', async () => {
      const { roomId, token: t1 } = await srv.createRoom('NormalFlow', 'alice');
      const t2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectSync());
      ws1.send(JSON.stringify({ type: 'auth', token: t1 }));
      await srv.waitForMessage(ws1, 'users');

      const ws2 = track(await srv.connectSync());
      ws2.send(JSON.stringify({ type: 'auth', token: t2 }));
      await srv.waitForMessage(ws2, 'users');
      await srv.delay(100);

      // Send 5 tab switches — all should arrive
      for (let i = 0; i < 5; i++) {
        ws1.send(JSON.stringify({ type: 'tab-switch', tabId: `tab-${i}` }));
      }

      const msgs = await srv.collectMessages(ws2, 5, 2000);
      const tabSwitches = msgs.filter(m => m.type === 'tab-switch');
      expect(tabSwitches.length).toBe(5);
    });
  });
});
