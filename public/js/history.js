window.Riptide = window.Riptide || {};

Riptide.History = {
  _panel: null,
  entries: [],

  init() {
    this._panel = Riptide.CollapsiblePanel.create({
      sectionId: 'history-section',
      listId: 'history-list',
      headerId: 'history-header',
      chevronClass: 'hist-chevron',
      badgeClass: 'hist-badge'
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'hist-clear-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.title = 'Clear command history';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._clearHistory();
    });
    this._panel.header.appendChild(clearBtn);
  },

  async load(tabId) {
    try {
      this.entries = await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/history`);
    } catch {
      this.entries = [];
    }
    this._render();
  },

  async log(tabId, command) {
    if (!tabId || !command) return;
    // Skip consecutive duplicate commands
    if (this.entries.length > 0 && this.entries[this.entries.length - 1].command === command) {
      return;
    }
    try {
      const data = await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/history`, {
        method: 'POST',
        body: { command }
      });
      this.entries.push(data.entry);
      if (this.entries.length > 100) {
        this.entries = this.entries.slice(-100);
      }
      this._render();
    } catch {
      // ignore
    }
  },

  addEntry(entry) {
    // Skip consecutive duplicate commands
    if (this.entries.length > 0 && this.entries[this.entries.length - 1].command === entry.command) {
      return;
    }
    this.entries.push(entry);
    if (this.entries.length > 100) {
      this.entries = this.entries.slice(-100);
    }
    this._render();
  },

  clearAll() {
    this.entries = [];
    this._render();
  },

  async _clearHistory() {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;

    const confirmed = await Riptide.Modal.confirm(
      'Clear History',
      'Clear all command history for this tab?'
    );
    if (!confirmed) return;

    try {
      await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/history`, {
        method: 'DELETE'
      });
      this.entries = [];
      this._render();
    } catch {
      // ignore
    }
  },

  _render() {
    this._panel.list.innerHTML = '';
    this._panel.badge.textContent = this.entries.length > 0 ? this.entries.length : '';

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      const row = document.createElement('div');
      row.className = 'hist-entry';

      const time = document.createElement('span');
      time.className = 'hist-time';
      const d = new Date(entry.timestamp);
      time.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const cmd = document.createElement('span');
      cmd.className = 'hist-cmd';
      cmd.textContent = entry.command;
      cmd.title = entry.command;

      const user = document.createElement('span');
      user.className = 'hist-user';
      user.textContent = entry.user || '';

      const runBtn = document.createElement('button');
      runBtn.className = 'hist-run-btn';
      runBtn.innerHTML = '&#9654;';
      runBtn.title = 'Re-run this command';
      runBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._rerun(entry.command);
      });

      row.appendChild(time);
      row.appendChild(cmd);
      row.appendChild(user);
      row.appendChild(runBtn);

      // Click row to copy command
      row.addEventListener('click', () => {
        Riptide.clipboard(entry.command);
      });

      this._panel.list.appendChild(row);
    }
  },

  _rerun(command) {
    const { result, missing } = Riptide.Variables.substituteCommand(command);
    if (missing.length > 0) {
      Riptide.toast('Missing: ' + missing.join(', '));
      return;
    }
    Riptide.Terminal.sendCommand(result);
    // Also log the re-run
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (tabId) {
      this.log(tabId, result);
    }
  }
};
