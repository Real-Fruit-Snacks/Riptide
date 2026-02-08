window.Riptide = window.Riptide || {};

Riptide.AuditLog = {
  _panel: null,
  entries: [],

  init() {
    this._panel = Riptide.CollapsiblePanel.create({
      sectionId: 'audit-section',
      listId: 'audit-list',
      headerId: 'audit-header',
      chevronClass: 'audit-chevron',
      badgeClass: 'audit-badge'
    });
  },

  async load(tabId) {
    try {
      this.entries = await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/audit`);
    } catch {
      this.entries = [];
    }
    this._render();
  },

  async log(tabId, { playbookTitle, noteId, command, variables, type }) {
    if (!tabId || !command) return;
    try {
      const data = await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/audit`, {
        method: 'POST',
        body: { playbookTitle, noteId, command, variables, type }
      });
      this.entries.push(data.entry);
      if (this.entries.length > 200) {
        this.entries = this.entries.slice(-200);
      }
      this._render();
    } catch {
      // ignore
    }
  },

  addEntry(entry) {
    this.entries.push(entry);
    if (this.entries.length > 200) {
      this.entries = this.entries.slice(-200);
    }
    this._render();
  },

  clearAll() {
    this.entries = [];
    this._render();
  },

  _render() {
    this._panel.list.innerHTML = '';
    this._panel.badge.textContent = this.entries.length > 0 ? this.entries.length : '';

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      const row = document.createElement('div');
      row.className = 'audit-entry';

      const time = document.createElement('span');
      time.className = 'audit-time';
      const d = new Date(entry.timestamp);
      time.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const user = document.createElement('span');
      user.className = 'audit-user';
      user.textContent = entry.user || '';

      const playbook = document.createElement('span');
      playbook.className = 'audit-playbook';
      playbook.textContent = entry.playbookTitle || '';
      playbook.title = entry.playbookTitle || '';

      const cmd = document.createElement('span');
      cmd.className = 'audit-cmd';
      cmd.textContent = entry.command;
      cmd.title = entry.command;

      const typeEl = document.createElement('span');
      typeEl.className = 'audit-type audit-type-' + (entry.type || 'run');
      typeEl.textContent = entry.type === 'run-all' ? 'ALL' : (entry.type === 'rerun' ? 'RE' : 'RUN');

      row.appendChild(time);
      row.appendChild(user);
      row.appendChild(typeEl);
      row.appendChild(playbook);
      row.appendChild(cmd);

      // Show variables on hover via title
      if (entry.variables && Object.keys(entry.variables).length > 0) {
        const varStr = Object.entries(entry.variables)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        row.title = 'Variables: ' + varStr;
      }

      // Click to copy command
      row.addEventListener('click', () => {
        Riptide.clipboard(entry.command, 'Command');
      });

      this._panel.list.appendChild(row);
    }
  }
};
