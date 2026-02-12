window.Riptide = window.Riptide || {};

Riptide.Terminal = {
  // tabId -> { subTabs: Map<subTabId, instance>, activeSubTabId, nextIndex }
  instances: new Map(),
  activeTabId: null,
  parentContainer: null,
  MAX_SUB_TABS: 8,

  init() {
    this.parentContainer = document.getElementById('terminal-container');
    this._resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this.fit(), 150);
    });
  },

  initTab(tabId) {
    if (this.instances.has(tabId)) return;

    // Create the TabGroup
    const group = {
      subTabs: new Map(),
      activeSubTabId: '0',
      nextIndex: 1
    };
    this.instances.set(tabId, group);

    // Create the first sub-tab
    this._createSubTab(tabId, '0', 'Shell 1');
  },

  _createSubTab(tabId, subTabId, name) {
    const group = this.instances.get(tabId);
    if (!group) return null;

    // Create a child div for this sub-tab's terminal
    const container = document.createElement('div');
    container.id = `terminal-${tabId}-${subTabId}`;
    container.style.width = '100%';
    container.style.height = '100%';
    container.classList.add('hidden');
    this.parentContainer.appendChild(container);

    const settings = Riptide.Settings;
    const term = new Terminal({
      cursorBlink: settings ? settings.get('cursorBlink') : true,
      cursorStyle: settings ? settings.get('cursorStyle') : 'block',
      fontSize: settings ? settings.get('terminalFontSize') : 14,
      scrollback: settings ? settings.get('scrollbackLines') : 5000,
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
    term.loadAddon(new WebLinksAddon.WebLinksAddon());
    term.open(container);

    const instance = { term, fitAddon, container, ws: null, tabId, subTabId, name };
    group.subTabs.set(subTabId, instance);

    // Register onData ONCE -- reads instance.ws dynamically
    term.onData((data) => {
      const ws = instance.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    this._connectWebSocket(instance);
    return instance;
  },

  _connectWebSocket(instance) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/terminal`;
    const ws = new WebSocket(wsUrl);
    instance.ws = ws;

    ws.onopen = () => {
      // Reset reconnect delay on successful connection
      instance._reconnectDelay = 2000;

      // Send init to associate this connection with the tab's PTY
      ws.send(JSON.stringify({
        type: 'init',
        tabId: instance.tabId,
        subTabId: instance.subTabId,
        token: Riptide.Auth.token,
        cols: instance.term.cols,
        rows: instance.term.rows
      }));

      // Send any pending resize that occurred during reconnect
      if (instance._pendingResize) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: instance._pendingResize.cols,
          rows: instance._pendingResize.rows
        }));
        instance._pendingResize = null;
      }
    };

    ws.onmessage = (event) => {
      instance.term.write(event.data);
      // Hook for session recorder
      if (Riptide.Recorder && Riptide.Recorder._onTerminalData) {
        Riptide.Recorder._onTerminalData(instance.tabId, event.data, instance.subTabId);
      }
    };

    ws.onclose = () => {
      instance.term.write('\r\n\x1b[31m[Connection closed. Reconnecting...]\x1b[0m\r\n');
      // Only reconnect if the tab and sub-tab still exist
      const group = this.instances.get(instance.tabId);
      if (group && group.subTabs.has(instance.subTabId)) {
        const delay = instance._reconnectDelay || 2000;
        instance._reconnectDelay = Math.min(delay * 2, 30000);
        setTimeout(() => this._connectWebSocket(instance), delay);
      }
    };

    ws.onerror = () => {};
  },

  addSubTab(tabId) {
    const group = this.instances.get(tabId);
    if (!group) return null;
    if (group.subTabs.size >= this.MAX_SUB_TABS) return null;

    const subTabId = String(group.nextIndex);
    const name = 'Shell ' + (group.nextIndex + 1);
    group.nextIndex++;

    this._createSubTab(tabId, subTabId, name);
    this.switchSubTab(tabId, subTabId);
    return { subTabId, name };
  },

  removeSubTab(tabId, subTabId) {
    const group = this.instances.get(tabId);
    if (!group) return;
    // Cannot remove the last sub-tab
    if (group.subTabs.size <= 1) return;

    const inst = group.subTabs.get(subTabId);
    if (!inst) return;

    // Remove from map first to prevent reconnect attempts
    group.subTabs.delete(subTabId);

    if (inst.ws) inst.ws.close();
    inst.term.dispose();
    inst.container.remove();

    // If we removed the active sub-tab, switch to the first remaining
    if (group.activeSubTabId === subTabId) {
      const firstKey = group.subTabs.keys().next().value;
      this.switchSubTab(tabId, firstKey);
    }
  },

  switchSubTab(tabId, subTabId) {
    const group = this.instances.get(tabId);
    if (!group || !group.subTabs.has(subTabId)) return;

    // Hide current active sub-tab
    const currentInst = group.subTabs.get(group.activeSubTabId);
    if (currentInst) {
      currentInst.container.classList.add('hidden');
    }

    group.activeSubTabId = subTabId;

    // Only show and fit if this is the currently visible tab
    if (this.activeTabId === tabId) {
      const newInst = group.subTabs.get(subTabId);
      newInst.container.classList.remove('hidden');
      requestAnimationFrame(() => {
        newInst.fitAddon.fit();
        if (newInst.ws && newInst.ws.readyState === WebSocket.OPEN) {
          newInst.ws.send(JSON.stringify({
            type: 'resize',
            cols: newInst.term.cols,
            rows: newInst.term.rows
          }));
        } else {
          newInst._pendingResize = { cols: newInst.term.cols, rows: newInst.term.rows };
        }
      });
    }
  },

  renameSubTab(tabId, subTabId, name) {
    const group = this.instances.get(tabId);
    if (!group) return;
    const inst = group.subTabs.get(subTabId);
    if (inst) inst.name = name;
  },

  getSubTabs(tabId) {
    const group = this.instances.get(tabId);
    if (!group) return [];
    const result = [];
    for (const [id, inst] of group.subTabs) {
      result.push({ subTabId: id, name: inst.name, active: id === group.activeSubTabId });
    }
    return result;
  },

  _getActiveSubTab(tabId) {
    const group = this.instances.get(tabId || this.activeTabId);
    if (!group) return null;
    return group.subTabs.get(group.activeSubTabId) || null;
  },

  switchTo(tabId) {
    // Hide ALL sub-tab containers of the previously active tab
    if (this.activeTabId && this.instances.has(this.activeTabId)) {
      const prevGroup = this.instances.get(this.activeTabId);
      for (const [, inst] of prevGroup.subTabs) {
        inst.container.classList.add('hidden');
      }
    }

    this.activeTabId = tabId;

    const group = this.instances.get(tabId);
    if (group) {
      const inst = group.subTabs.get(group.activeSubTabId);
      if (inst) {
        inst.container.classList.remove('hidden');
        // Must fit after becoming visible
        requestAnimationFrame(() => {
          inst.fitAddon.fit();
          if (inst.ws && inst.ws.readyState === WebSocket.OPEN) {
            inst.ws.send(JSON.stringify({
              type: 'resize',
              cols: inst.term.cols,
              rows: inst.term.rows
            }));
          } else {
            // Queue resize for when WebSocket reconnects
            inst._pendingResize = { cols: inst.term.cols, rows: inst.term.rows };
          }
        });
      }
    }
  },

  destroyTab(tabId) {
    const group = this.instances.get(tabId);
    if (!group) return;

    // Remove from map first to prevent reconnect attempts on any sub-tab
    this.instances.delete(tabId);

    for (const [, inst] of group.subTabs) {
      if (inst.ws) inst.ws.close();
      inst.term.dispose();
      inst.container.remove();
    }
    group.subTabs.clear();
  },

  fit() {
    if (!this.activeTabId) return;
    const inst = this._getActiveSubTab(this.activeTabId);
    if (!inst) return;
    inst.fitAddon.fit();
    if (inst.ws && inst.ws.readyState === WebSocket.OPEN) {
      inst.ws.send(JSON.stringify({
        type: 'resize',
        cols: inst.term.cols,
        rows: inst.term.rows
      }));
    }
  },

  sendCommand(command, opts) {
    if (!this.activeTabId) return;
    const inst = this._getActiveSubTab(this.activeTabId);
    if (!inst || !inst.ws || inst.ws.readyState !== WebSocket.OPEN) return;
    inst.ws.send(JSON.stringify({ type: 'input', data: command + '\r' }));
    inst.term.focus();
    // Audit log for manually typed/re-run commands (playbook runs are logged in preview.js)
    if (!(opts && opts.skipAudit) && Riptide.AuditLog) {
      Riptide.AuditLog.log(this.activeTabId, {
        playbookTitle: (opts && opts.playbookTitle) || '',
        noteId: (opts && opts.noteId) || '',
        command,
        variables: Riptide.Variables ? Riptide.Variables.getEffective() : {},
        type: (opts && opts.type) || 'manual'
      });
    }
  },

  markCommandStart(tabId) {
    const inst = this._getActiveSubTab(tabId || this.activeTabId);
    if (!inst) return null;
    const buf = inst.term.buffer.active;
    const cursorLine = buf.baseY + buf.cursorY;

    // Snapshot the cursor line text (just the prompt before command echo)
    const lineObj = buf.getLine(cursorLine);
    const promptText = lineObj ? lineObj.translateToString(true) : '';

    const mark = { line: cursorLine, promptText };
    // Store globally for toolbar capture button
    inst.lastRunMark = mark;
    // Return so callers can store it per-block
    return mark;
  },

  captureLastOutput(tabId) {
    const inst = this._getActiveSubTab(tabId || this.activeTabId);
    if (!inst || !inst.lastRunMark) return null;
    return this.captureOutputFromMark(tabId, inst.lastRunMark);
  },

  captureOutputFromMark(tabId, mark) {
    const inst = this._getActiveSubTab(tabId || this.activeTabId);
    if (!inst || !mark) return null;

    const buf = inst.term.buffer.active;
    const endLine = buf.baseY + buf.cursorY;

    // Determine where output starts.
    // Normally mark.line is the echoed command line, so output = mark.line + 1.
    // But if the line at mark.line no longer starts with what was there at mark
    // time (prompt got overwritten by scrolling), mark.line may already point
    // at the first output row -- in that case don't skip it.
    let outputStart = mark.line + 1;

    // Check if mark is still in the scrollback buffer
    const bufferStart = buf.baseY > buf.length ? buf.baseY - buf.length : 0;
    let truncated = false;
    if (mark.line < bufferStart) {
      outputStart = bufferStart;
      truncated = true;
    }

    const echoLine = buf.getLine(mark.line);
    if (echoLine && mark.promptText) {
      const currentText = echoLine.translateToString(true);
      // At mark time the line had only the prompt (e.g. "> ").
      // After echo it should be longer (e.g. "> docker ps").
      // If the current text is the same length or shorter, mark.line
      // is probably already pointing at output, not the echo.
      if (currentText.length <= mark.promptText.length) {
        outputStart = mark.line;
      }
    }

    // Always skip the cursor line (current prompt)
    let outputEnd = endLine - 1;

    // Trim trailing blank lines (works for all prompt styles)
    while (outputEnd >= outputStart) {
      const line = buf.getLine(outputEnd);
      if (line && line.translateToString(true).trim() !== '') break;
      outputEnd--;
    }

    if (outputEnd < outputStart) return null;

    const lines = [];
    for (let i = outputStart; i <= outputEnd; i++) {
      const line = buf.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }

    // Remove empty trailing lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }

    if (lines.length === 0) return null;
    const output = lines.join('\n');
    if (truncated) {
      return '[ ... output truncated — exceeded scrollback buffer ... ]\n' + output;
    }
    return output;
  }
};
