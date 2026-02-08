'use strict';

const WebSocket = require('ws');
const { startTestServer } = require('../helpers/ws-server');

describe('WebSocket Terminal (/ws/terminal)', () => {
  let srv;
  const openSockets = [];

  /** Track sockets for cleanup */
  function track(ws) {
    openSockets.push(ws);
    return ws;
  }

  /** Helper: get the first tab ID from a room */
  async function getFirstTabId(roomId) {
    const data = await srv.storage.readRoomTabs(roomId);
    return data.tabs[0].id;
  }

  beforeAll(async () => {
    srv = await startTestServer();
  });

  afterEach(() => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openSockets.length = 0;
  });

  afterAll(async () => {
    await srv.shutdown();
  });

  // ── Connection ────────────────────────────────────────────────────

  describe('Connection', () => {
    it('init with valid token and tab opens PTY', async () => {
      const { roomId, token } = await srv.createRoom('TermConn', 'alice');
      const tabId = await getFirstTabId(roomId);

      const ws = track(await srv.connectTerminal());
      ws.send(JSON.stringify({ type: 'init', token, tabId }));

      // Give time for init to process
      await srv.delay(200);

      // PTY should be created
      const ptyKey = `${roomId}:${tabId}:0`;
      expect(srv.ptyProcesses.has(ptyKey)).toBe(true);
      expect(srv.ptyProcesses.get(ptyKey).clients.size).toBeGreaterThanOrEqual(1);
    });

    it('init with invalid token closes connection', async () => {
      const ws = track(await srv.connectTerminal());
      const closePromise = srv.waitForClose(ws);
      ws.send(JSON.stringify({ type: 'init', token: 'bad-token', tabId: 'abc12345' }));
      await closePromise;
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('init with non-existent tab closes connection', async () => {
      const { token } = await srv.createRoom('TermBadTab', 'alice');

      const ws = track(await srv.connectTerminal());
      const closePromise = srv.waitForClose(ws);
      ws.send(JSON.stringify({ type: 'init', token, tabId: 'deadbeef' }));
      await closePromise;
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });
  });

  // ── I/O ───────────────────────────────────────────────────────────

  describe('I/O', () => {
    it('input message writes to PTY (echoed back via mock)', async () => {
      const { roomId, token } = await srv.createRoom('TermIO', 'alice');
      const tabId = await getFirstTabId(roomId);

      const ws = track(await srv.connectTerminal());
      ws.send(JSON.stringify({ type: 'init', token, tabId }));
      await srv.delay(200);

      // Send input — mock PTY echoes back
      const dataPromise = new Promise((resolve) => {
        ws.once('message', (data) => resolve(data.toString()));
      });
      ws.send(JSON.stringify({ type: 'input', data: 'hello world' }));

      const output = await dataPromise;
      expect(output).toBe('hello world');
    });

    it('resize message does not error', async () => {
      const { roomId, token } = await srv.createRoom('TermResize', 'alice');
      const tabId = await getFirstTabId(roomId);

      const ws = track(await srv.connectTerminal());
      ws.send(JSON.stringify({ type: 'init', token, tabId }));
      await srv.delay(200);

      // Resize should not cause any errors or close connection
      ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
      await srv.delay(200);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    it('output from PTY is sent to connected client', async () => {
      const { roomId, token } = await srv.createRoom('TermOutput', 'alice');
      const tabId = await getFirstTabId(roomId);

      const ws = track(await srv.connectTerminal());
      ws.send(JSON.stringify({ type: 'init', token, tabId }));
      await srv.delay(200);

      // Directly write to mock PTY to simulate output
      const ptyKey = `${roomId}:${tabId}:0`;
      const entry = srv.ptyProcesses.get(ptyKey);

      const dataPromise = new Promise((resolve) => {
        ws.once('message', (data) => resolve(data.toString()));
      });
      entry.pty.write('server output');

      const output = await dataPromise;
      expect(output).toBe('server output');
    });
  });

  // ── Buffering ─────────────────────────────────────────────────────

  describe('Buffering', () => {
    it('output is buffered for late-joining clients', async () => {
      const { roomId, token } = await srv.createRoom('TermBuffer', 'alice');
      const tabId = await getFirstTabId(roomId);

      // First client connects and generates output
      const ws1 = track(await srv.connectTerminal());
      ws1.send(JSON.stringify({ type: 'init', token, tabId }));
      await srv.delay(200);

      ws1.send(JSON.stringify({ type: 'input', data: 'buffered content' }));
      await srv.delay(100);

      // Verify buffer has content
      const ptyKey = `${roomId}:${tabId}:0`;
      const entry = srv.ptyProcesses.get(ptyKey);
      expect(entry.bufferSize).toBeGreaterThan(0);
    });

    it('buffer replayed on new client init', async () => {
      const { roomId, token } = await srv.createRoom('TermReplay', 'alice');
      const tabId = await getFirstTabId(roomId);

      // First client sends data
      const ws1 = track(await srv.connectTerminal());
      ws1.send(JSON.stringify({ type: 'init', token, tabId }));
      await srv.delay(200);

      // Consume the echo from ws1
      const echo1 = new Promise(resolve => ws1.once('message', resolve));
      ws1.send(JSON.stringify({ type: 'input', data: 'replay me' }));
      await echo1;
      await srv.delay(100);

      // Second client joins same PTY — should receive buffered output
      const token2 = srv.createSession(roomId, 'bob');
      const ws2 = track(await srv.connectTerminal());

      const replayPromise = new Promise((resolve) => {
        ws2.once('message', (data) => resolve(data.toString()));
      });
      ws2.send(JSON.stringify({ type: 'init', token: token2, tabId }));

      const replayed = await replayPromise;
      expect(replayed).toContain('replay me');
    });

    it('buffer caps at PTY_BUFFER_BYTES', async () => {
      const { roomId, token } = await srv.createRoom('TermBufferCap', 'alice');
      const tabId = await getFirstTabId(roomId);

      const ws = track(await srv.connectTerminal());
      ws.send(JSON.stringify({ type: 'init', token, tabId }));
      await srv.delay(200);

      // Write more than PTY_BUFFER_BYTES to the PTY directly
      const ptyKey = `${roomId}:${tabId}:0`;
      const entry = srv.ptyProcesses.get(ptyKey);
      const chunkSize = 10000;
      const totalChunks = Math.ceil((srv.LIMITS.PTY_BUFFER_BYTES * 1.5) / chunkSize);

      // Drain messages from ws so they don't buffer in node
      ws.on('message', () => {});

      for (let i = 0; i < totalChunks; i++) {
        entry.pty.write('A'.repeat(chunkSize));
      }
      await srv.delay(200);

      // Buffer should not exceed PTY_BUFFER_BYTES
      expect(entry.bufferSize).toBeLessThanOrEqual(srv.LIMITS.PTY_BUFFER_BYTES);
    });
  });

  // ── Multi-client ──────────────────────────────────────────────────

  describe('Multi-client', () => {
    it('multiple clients see same PTY output', async () => {
      const { roomId, token } = await srv.createRoom('TermMulti', 'alice');
      const tabId = await getFirstTabId(roomId);
      const token2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectTerminal());
      ws1.send(JSON.stringify({ type: 'init', token, tabId }));
      await srv.delay(200);

      // Consume replay for ws2
      const ws2 = track(await srv.connectTerminal());
      ws2.send(JSON.stringify({ type: 'init', token: token2, tabId }));
      await srv.delay(200);

      // Both should receive the same output
      const p1 = new Promise(resolve => ws1.once('message', d => resolve(d.toString())));
      const p2 = new Promise(resolve => ws2.once('message', d => resolve(d.toString())));

      ws1.send(JSON.stringify({ type: 'input', data: 'shared output' }));

      const [out1, out2] = await Promise.all([p1, p2]);
      expect(out1).toBe('shared output');
      expect(out2).toBe('shared output');
    });

    it('client disconnect does not kill PTY', async () => {
      const { roomId, token } = await srv.createRoom('TermNoKill', 'alice');
      const tabId = await getFirstTabId(roomId);
      const token2 = srv.createSession(roomId, 'bob');

      const ws1 = track(await srv.connectTerminal());
      ws1.send(JSON.stringify({ type: 'init', token, tabId }));
      await srv.delay(200);

      const ws2 = track(await srv.connectTerminal());
      ws2.send(JSON.stringify({ type: 'init', token: token2, tabId }));
      await srv.delay(200);

      // Disconnect first client
      ws1.close();
      await srv.delay(200);

      // PTY should still exist
      const ptyKey = `${roomId}:${tabId}:0`;
      expect(srv.ptyProcesses.has(ptyKey)).toBe(true);

      // Second client should still work
      const p = new Promise(resolve => ws2.once('message', d => resolve(d.toString())));
      ws2.send(JSON.stringify({ type: 'input', data: 'still alive' }));
      const out = await p;
      expect(out).toBe('still alive');
    });
  });

  // ── PTY Limit ─────────────────────────────────────────────────────

  describe('PTY Limit', () => {
    it('rejects new PTY when MAX_PTY_PER_ROOM reached', async () => {
      const { roomId, token } = await srv.createRoom('PtyLimit', 'alice');
      const tabId = await getFirstTabId(roomId);

      // Temporarily lower the limit for this test
      const origLimit = srv.LIMITS.MAX_PTY_PER_ROOM;
      srv.LIMITS.MAX_PTY_PER_ROOM = 2;

      try {
        // Create 2 PTYs with different subTabIds
        const ws1 = track(await srv.connectTerminal());
        ws1.send(JSON.stringify({ type: 'init', token, tabId, subTabId: 'sub0' }));
        await srv.delay(200);

        const ws2 = track(await srv.connectTerminal());
        ws2.send(JSON.stringify({ type: 'init', token, tabId, subTabId: 'sub1' }));
        await srv.delay(200);

        // Third PTY should be rejected
        const ws3 = track(await srv.connectTerminal());
        const closePromise = srv.waitForClose(ws3);

        // Collect error message before close
        const errorPromise = new Promise((resolve) => {
          ws3.once('message', (data) => {
            try { resolve(JSON.parse(data.toString())); } catch (_e) { resolve(null); }
          });
        });

        ws3.send(JSON.stringify({ type: 'init', token, tabId, subTabId: 'sub2' }));

        const [errorMsg] = await Promise.all([errorPromise, closePromise]);
        expect(errorMsg).toBeDefined();
        expect(errorMsg.error).toContain('PTY limit');
      } finally {
        srv.LIMITS.MAX_PTY_PER_ROOM = origLimit;
      }
    });

    it('can create PTYs up to the limit', async () => {
      const { roomId, token } = await srv.createRoom('PtyWithinLimit', 'alice');
      const tabId = await getFirstTabId(roomId);

      const origLimit = srv.LIMITS.MAX_PTY_PER_ROOM;
      srv.LIMITS.MAX_PTY_PER_ROOM = 3;

      try {
        for (let i = 0; i < 3; i++) {
          const ws = track(await srv.connectTerminal());
          ws.send(JSON.stringify({ type: 'init', token, tabId, subTabId: `s${i}` }));
          await srv.delay(150);
        }

        // Count PTYs for this room
        let count = 0;
        const prefix = roomId + ':';
        for (const key of srv.ptyProcesses.keys()) {
          if (key.startsWith(prefix)) count++;
        }
        expect(count).toBe(3);
      } finally {
        srv.LIMITS.MAX_PTY_PER_ROOM = origLimit;
      }
    });
  });

  // ── Rate Limiting ─────────────────────────────────────────────────

  describe('Rate Limiting', () => {
    it('messages within rate limit work', async () => {
      const { roomId, token } = await srv.createRoom('TermRateOK', 'alice');
      const tabId = await getFirstTabId(roomId);

      const ws = track(await srv.connectTerminal());
      ws.send(JSON.stringify({ type: 'init', token, tabId }));
      await srv.delay(200);

      // Send a few input messages — all should echo back
      const received = [];
      ws.on('message', (data) => received.push(data.toString()));

      for (let i = 0; i < 5; i++) {
        ws.send(JSON.stringify({ type: 'input', data: `msg${i}` }));
      }
      await srv.delay(500);

      expect(received.length).toBe(5);
      expect(received).toEqual(['msg0', 'msg1', 'msg2', 'msg3', 'msg4']);
    });

    it('messages over rate limit are dropped', async () => {
      const { roomId, token } = await srv.createRoom('TermRateOver', 'alice');
      const tabId = await getFirstTabId(roomId);

      const ws = track(await srv.connectTerminal());
      ws.send(JSON.stringify({ type: 'init', token, tabId }));
      await srv.delay(200);

      const received = [];
      ws.on('message', (data) => received.push(data.toString()));

      // Flood with messages exceeding the rate limit
      // The init message already counted as 1, so we have limit-1 remaining
      const limit = srv.LIMITS.WS_RATE_LIMIT_PER_SEC;
      for (let i = 0; i < limit + 50; i++) {
        ws.send(JSON.stringify({ type: 'input', data: `flood${i}` }));
      }
      await srv.delay(500);

      // Should receive fewer than what we sent (rate limited)
      // init message was 1, so at most limit-1 input messages get through
      expect(received.length).toBeLessThanOrEqual(limit - 1);
      expect(received.length).toBeGreaterThan(0);
    });
  });
});
