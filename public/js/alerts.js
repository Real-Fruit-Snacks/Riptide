window.Riptide = window.Riptide || {};

Riptide.Alerts = {
  _panel: null,
  _clearBtn: null,
  entries: [],

  init() {
    this._panel = Riptide.CollapsiblePanel.create({
      sectionId: 'alerts-section',
      listId: 'alerts-list',
      headerId: 'alerts-header',
      chevronClass: 'alerts-chevron',
      badgeClass: 'alerts-badge',
      label: 'Alerts'
    });

    // Clear button
    this._clearBtn = document.createElement('button');
    this._clearBtn.className = 'alerts-clear-btn';
    this._clearBtn.textContent = 'Clear';
    this._clearBtn.title = 'Clear all alerts';
    this._clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._clearAll();
    });
    this._panel.header.appendChild(this._clearBtn);
  },

  async load() {
    try {
      this.entries = await Riptide.api('/api/alerts');
    } catch {
      this.entries = [];
    }
    this._render();
  },

  addEntry(alert) {
    this.entries.push(alert);
    if (this.entries.length > 200) {
      this.entries = this.entries.slice(-200);
    }
    this._render();
    // Flash the badge
    this._panel.badge.classList.add('alerts-badge-flash');
    setTimeout(() => this._panel.badge.classList.remove('alerts-badge-flash'), 1500);
  },

  flag(context, title, preview, toastMsg) {
    const alert = {
      context,
      title,
      preview,
      nickname: Riptide.Auth.nickname || '',
      timestamp: new Date().toISOString()
    };

    if (Riptide.Sync && Riptide.Sync._ws && Riptide.Sync._ws.readyState === 1) {
      Riptide.Sync._ws.send(JSON.stringify({ type: 'finding-flagged', ...alert }));
    }

    this.addEntry(alert);
    Riptide.toast(toastMsg || 'Finding flagged to teammates');
  },

  clearEntries() {
    this.entries = [];
    this._render();
  },

  async _clearAll() {
    if (this.entries.length === 0) return;
    const confirmed = await Riptide.Modal.confirm(
      'Clear alerts',
      'Clear all alert history?'
    );
    if (!confirmed) return;
    try {
      await Riptide.api('/api/alerts', {
        method: 'DELETE'
      });
      this.entries = [];
      this._render();
    } catch {
      Riptide.toast('Failed to clear alerts');
    }
  },

  _render() {
    this._panel.list.innerHTML = '';
    this._panel.badge.textContent = this.entries.length > 0 ? this.entries.length : '';

    // Show newest first
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      const row = document.createElement('div');
      row.className = 'alerts-entry';

      // Context badge (playbook/credential/note)
      const ctxBadge = document.createElement('span');
      ctxBadge.className = 'alerts-ctx-badge';
      const ctxLabels = { playbook: 'PB', credential: 'CR', note: 'NT', 'root-flag': 'RF', 'user-flag': 'UF' };
      ctxBadge.textContent = ctxLabels[entry.context] || 'FL';
      const ctxClass = (entry.context || 'finding').replace(/\s+/g, '-');
      ctxBadge.classList.add('alerts-ctx-' + ctxClass);

      // Timestamp
      const time = document.createElement('span');
      time.className = 'alerts-time';
      const d = new Date(entry.timestamp);
      time.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // User
      const user = document.createElement('span');
      user.className = 'alerts-user';
      user.textContent = entry.nickname || '';

      // KB button
      const kbBtn = document.createElement('button');
      kbBtn.className = 'alerts-kb-btn';
      kbBtn.title = 'Save to Knowledge Base';
      kbBtn.textContent = 'KB';
      kbBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (Riptide.Knowledge) {
          Riptide.Knowledge.saveFromAlert(entry);
        }
      });

      // Meta line
      const meta = document.createElement('div');
      meta.className = 'alerts-meta';
      meta.appendChild(ctxBadge);
      meta.appendChild(time);
      meta.appendChild(user);
      meta.appendChild(kbBtn);

      // Title
      const titleEl = document.createElement('div');
      titleEl.className = 'alerts-title';
      titleEl.textContent = entry.title || '';

      // Preview
      const previewEl = document.createElement('div');
      previewEl.className = 'alerts-preview';
      previewEl.textContent = entry.preview || '';

      row.appendChild(meta);
      if (entry.title) row.appendChild(titleEl);
      if (entry.preview) row.appendChild(previewEl);

      this._panel.list.appendChild(row);
    }
  }
};
