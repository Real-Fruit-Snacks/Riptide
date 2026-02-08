window.Riptide = window.Riptide || {};

Riptide.Recorder = {
  _recordings: new Map(), // tabId -> { events, startTime, cols, rows }
  _autoRecord: true,
  _recordBtn: null,

  init() {
    this._recordBtn = document.getElementById('btn-record');
    if (!this._recordBtn) return;

    this._recordBtn.addEventListener('click', () => {
      const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
      if (!tabId) return;

      if (this._recordings.has(tabId)) {
        this.stopTab(tabId);
      } else {
        this.startTab(tabId);
      }
    });

    this._updateButton();

    // Apply stored auto-record setting
    if (Riptide.Settings) {
      this._autoRecord = Riptide.Settings.get('autoRecord');
    }
  },

  // Called from terminal.js ws.onmessage hook
  _onTerminalData(tabId, data) {
    const rec = this._recordings.get(tabId);
    if (!rec) return;
    const elapsed = (Date.now() - rec.startTime) / 1000;
    rec.events.push([elapsed, 'o', data]);
  },

  startTab(tabId) {
    if (!tabId || this._recordings.has(tabId)) return;

    const inst = Riptide.Terminal._getActiveSubTab(tabId);
    if (!inst) return;

    this._recordings.set(tabId, {
      events: [],
      startTime: Date.now(),
      cols: inst.term ? inst.term.cols : 80,
      rows: inst.term ? inst.term.rows : 24
    });

    this._updateButton();
  },

  stopTab(tabId) {
    const rec = this._recordings.get(tabId);
    if (!rec) return;

    this._recordings.delete(tabId);
    this._updateButton();

    if (rec.events.length === 0) {
      Riptide.toast('No data recorded');
      return rec;
    }

    const duration = rec.events[rec.events.length - 1][0];
    Riptide.toast(
      'Recorded ' + Math.round(duration) + 's (' + rec.events.length + ' frames)'
    );

    // Auto-save to server (fire-and-forget)
    this._saveToServer(tabId, rec);

    this._showRecordingActions(rec);
    return rec;
  },

  // Auto-start recording for a tab (called from app.js on tab switch/create)
  autoStart(tabId) {
    if (!this._autoRecord) return;
    if (this._recordings.has(tabId)) return;
    this.startTab(tabId);
  },

  // Toggle auto-record globally
  toggleAutoRecord() {
    this._autoRecord = !this._autoRecord;
    if (!this._autoRecord) {
      // Stop all active recordings silently (don't show actions)
      for (const tabId of [...this._recordings.keys()]) {
        this._recordings.delete(tabId);
      }
    } else {
      // Start recording current tab
      const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
      if (tabId) this.startTab(tabId);
    }
    this._updateButton();
    Riptide.toast(
      this._autoRecord ? 'Auto-recording enabled' : 'Auto-recording disabled'
    );
  },

  // Update button visual to reflect current tab state
  _updateButton() {
    if (!this._recordBtn) return;
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    const isRecording = tabId && this._recordings.has(tabId);

    if (isRecording) {
      this._recordBtn.classList.add('recording');
      this._recordBtn.title = 'Recording — click to stop & export';
    } else if (this._autoRecord) {
      this._recordBtn.classList.remove('recording');
      this._recordBtn.title = 'Auto-recording paused — click to start';
    } else {
      this._recordBtn.classList.remove('recording');
      this._recordBtn.title = 'Auto-recording disabled — click to start manually';
    }
  },

  // Called on tab switch to update button state
  onTabSwitch(tabId) {
    this.autoStart(tabId);
    this._updateButton();
  },

  async _showRecordingActions(rec) {
    const lastEvent = rec.events[rec.events.length - 1];
    const choice = await Riptide.Modal.choose(
      'Recording Complete',
      'Captured ' + rec.events.length + ' frames (' + Math.round(lastEvent[0]) + 's). What would you like to do?',
      'Play Back',
      'Export .cast'
    );

    if (choice === 'a') {
      this._playback(rec);
    } else if (choice === 'b') {
      this._exportCast(rec);
    }
  },

  _playback(rec) {
    if (!rec || rec.events.length === 0) return;

    const overlay = document.createElement('div');
    overlay.className = 'recorder-overlay';

    const popup = document.createElement('div');
    popup.className = 'recorder-popup';

    // Header
    const header = document.createElement('div');
    header.className = 'recorder-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'recorder-title';
    titleEl.textContent = 'Session Playback';

    const progressEl = document.createElement('span');
    progressEl.className = 'recorder-progress';

    const controls = document.createElement('div');
    controls.className = 'recorder-controls';

    const playBtn = document.createElement('button');
    playBtn.className = 'recorder-btn';
    playBtn.textContent = '\u25B6 Play';

    const speedBtn = document.createElement('button');
    speedBtn.className = 'recorder-btn';
    speedBtn.textContent = '1x';
    let speed = 1;

    const exportBtn = document.createElement('button');
    exportBtn.className = 'recorder-btn';
    exportBtn.textContent = '\u2193 Export';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'recorder-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close';

    controls.appendChild(playBtn);
    controls.appendChild(speedBtn);
    controls.appendChild(exportBtn);

    header.appendChild(titleEl);
    header.appendChild(progressEl);
    header.appendChild(controls);
    header.appendChild(closeBtn);

    // Scrub bar
    const scrubContainer = document.createElement('div');
    scrubContainer.className = 'recorder-scrub';

    const scrubBar = document.createElement('input');
    scrubBar.type = 'range';
    scrubBar.className = 'recorder-scrub-bar';
    scrubBar.min = '0';
    scrubBar.step = '0.01';
    scrubBar.value = '0';

    const scrubTime = document.createElement('span');
    scrubTime.className = 'recorder-scrub-time';
    scrubTime.textContent = '0:00 / 0:00';

    scrubContainer.appendChild(scrubBar);
    scrubContainer.appendChild(scrubTime);

    // Terminal container
    const termContainer = document.createElement('div');
    termContainer.className = 'recorder-terminal';

    popup.appendChild(header);
    popup.appendChild(scrubContainer);
    popup.appendChild(termContainer);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Create playback terminal
    const term = new Terminal({
      cursorBlink: false,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      theme: Riptide.Theme ? Riptide.Theme.getTerminalTheme() : {
        background: '#24273a',
        foreground: '#cad3f5',
        cursor: '#f4dbd6',
        selectionBackground: '#494d64',
        black: '#494d64',
        red: '#ed8796',
        green: '#a6da95',
        yellow: '#eed49f',
        blue: '#8aadf4',
        magenta: '#f5bde6',
        cyan: '#8bd5ca',
        white: '#b8c0e0',
        brightBlack: '#5b6078',
        brightRed: '#ed8796',
        brightGreen: '#a6da95',
        brightYellow: '#eed49f',
        brightBlue: '#8aadf4',
        brightMagenta: '#f5bde6',
        brightCyan: '#8bd5ca',
        brightWhite: '#a5adcb'
      }
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(termContainer);

    requestAnimationFrame(() => fitAddon.fit());

    let playing = false;
    let timeouts = [];
    const events = rec.events;
    const totalDuration = events[events.length - 1][0];

    scrubBar.max = String(totalDuration);

    const formatTime = (secs) => {
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    };

    scrubTime.textContent = '0:00 / ' + formatTime(totalDuration);

    const updateScrub = (elapsed) => {
      scrubBar.value = String(elapsed);
      progressEl.textContent = Math.round(elapsed) + 's / ' + Math.round(totalDuration) + 's';
      scrubTime.textContent = formatTime(elapsed) + ' / ' + formatTime(totalDuration);
    };

    // Seek to a specific time: replay all events up to that point instantly
    const seekTo = (targetTime) => {
      term.reset();
      for (let i = 0; i < events.length; i++) {
        if (events[i][0] > targetTime) break;
        term.write(events[i][2]);
      }
      updateScrub(targetTime);
    };

    // Play from a given time offset
    const playFrom = (startTime) => {
      timeouts.forEach(t => clearTimeout(t));
      timeouts = [];
      playing = true;
      playBtn.textContent = '\u23F8 Pause';

      // Find first event index >= startTime
      let startIdx = 0;
      for (let i = 0; i < events.length; i++) {
        if (events[i][0] >= startTime) { startIdx = i; break; }
        if (i === events.length - 1) { startIdx = events.length; }
      }

      for (let i = startIdx; i < events.length; i++) {
        const evt = events[i];
        const elapsed = evt[0];
        const delay = ((elapsed - startTime) / speed) * 1000;

        timeouts.push(setTimeout(() => {
          term.write(evt[2]);
          updateScrub(elapsed);

          if (i === events.length - 1) {
            playing = false;
            playBtn.textContent = '\u25B6 Replay';
          }
        }, delay));
      }
    };

    const play = () => {
      seekTo(0);
      playFrom(0);
    };

    const stop = () => {
      timeouts.forEach(t => clearTimeout(t));
      timeouts = [];
      playing = false;
      playBtn.textContent = '\u25B6 Play';
    };

    playBtn.addEventListener('click', () => {
      if (playing) {
        stop();
      } else {
        // If at end, replay from start; otherwise play from current position
        const current = parseFloat(scrubBar.value);
        if (current >= totalDuration - 0.1) {
          play();
        } else {
          seekTo(current);
          playFrom(current);
        }
      }
    });

    const speeds = [1, 2, 4, 0.5];
    speedBtn.addEventListener('click', () => {
      const idx = speeds.indexOf(speed);
      speed = speeds[(idx + 1) % speeds.length];
      speedBtn.textContent = speed + 'x';

      if (playing) {
        const current = parseFloat(scrubBar.value);
        timeouts.forEach(t => clearTimeout(t));
        timeouts = [];
        playFrom(current);
      }
    });

    // Scrub bar interaction
    let wasScrubbing = false;
    scrubBar.addEventListener('mousedown', () => {
      wasScrubbing = playing;
      if (playing) {
        timeouts.forEach(t => clearTimeout(t));
        timeouts = [];
      }
    });

    scrubBar.addEventListener('input', () => {
      const targetTime = parseFloat(scrubBar.value);
      seekTo(targetTime);
    });

    scrubBar.addEventListener('mouseup', () => {
      if (wasScrubbing) {
        const targetTime = parseFloat(scrubBar.value);
        playFrom(targetTime);
      }
      wasScrubbing = false;
    });

    // Also handle change for keyboard/touch
    scrubBar.addEventListener('change', () => {
      const targetTime = parseFloat(scrubBar.value);
      seekTo(targetTime);
    });

    const self = this;
    exportBtn.addEventListener('click', () => {
      self._exportCast(rec);
    });

    const cleanup = () => {
      stop();
      term.dispose();
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    };

    const escHandler = (e) => {
      if (e.key === 'Escape') cleanup();
    };
    document.addEventListener('keydown', escHandler);

    closeBtn.addEventListener('click', cleanup);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
      }
    });

    // Auto-play
    play();
  },

  _serializeCast(rec) {
    if (!rec || rec.events.length === 0) return null;
    const header = JSON.stringify({
      version: 2,
      width: rec.cols || 80,
      height: rec.rows || 24,
      timestamp: Math.floor(rec.startTime / 1000),
      env: { SHELL: '/bin/bash', TERM: 'xterm-256color' }
    });
    const lines = [header];
    for (const evt of rec.events) {
      lines.push(JSON.stringify([evt[0], evt[1], evt[2]]));
    }
    return lines.join('\n') + '\n';
  },

  _exportCast(rec) {
    const content = this._serializeCast(rec);
    if (!content) return;
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = 'commandwave-' + ts + '.cast';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Riptide.toast('Exported as .cast file');
  },

  async _saveToServer(tabId, rec) {
    try {
      const cast = this._serializeCast(rec);
      if (!cast) return;
      const tab = Riptide.Tabs && Riptide.Tabs.tabs ? Riptide.Tabs.tabs.find(t => t.id === tabId) : null;
      const targetName = tab ? tab.name : 'recording';
      const subTab = Riptide.Terminal ? Riptide.Terminal._getActiveSubTab(tabId) : null;
      const subTabName = subTab && subTab.name ? subTab.name : '';
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const time = now.toTimeString().slice(0, 5).replace(':', '');
      const name = subTabName ? targetName + '-' + subTabName + '-' + date + '-' + time
        : targetName + '-' + date + '-' + time;
      await Riptide.api('/api/tabs/' + encodeURIComponent(tabId) + '/recordings', {
        method: 'POST',
        body: JSON.stringify({ name, cast })
      });
      // Refresh recordings panel if available
      if (Riptide.Recordings) Riptide.Recordings.load(tabId);
    } catch (err) {
      Riptide.toast('Failed to save recording: ' + err.message);
    }
  }
};
