window.Riptide = window.Riptide || {};

Riptide.Settings = {
  _defaults: {
    terminalFontSize: 14,
    cursorStyle: 'block',
    cursorBlink: true,
    autoRecord: true,
    scrollbackLines: 1000,
    editorFontSize: 14,
    timestampFormat: '24h',
  },

  _settings: {},
  _overlay: null,
  _activeCategory: 'general',

  init() {
    this._load();
    const btn = document.getElementById('btn-room-settings');
    if (btn) {
      btn.addEventListener('click', () => this.open());
    }
  },

  _load() {
    const stored = localStorage.getItem('cw_settings');
    let parsed = {};
    if (stored) {
      try { parsed = JSON.parse(stored); } catch { /* ignore corrupt data */ }
    }
    this._settings = { ...this._defaults, ...parsed };
  },

  _save() {
    localStorage.setItem('cw_settings', JSON.stringify(this._settings));
  },

  get(key) {
    return this._settings[key] !== undefined ? this._settings[key] : this._defaults[key];
  },

  set(key, value) {
    this._settings[key] = value;
    this._save();
    this._applyChange(key, value);
  },

  _applyChange(key, value) {
    switch (key) {
      case 'terminalFontSize':
      case 'cursorStyle':
      case 'cursorBlink':
      case 'scrollbackLines':
        this._applyTerminalSettings();
        break;
      case 'autoRecord':
        if (Riptide.Recorder) {
          Riptide.Recorder._autoRecord = value;
          Riptide.Recorder._updateButton();
        }
        break;
    }
  },

  _applyTerminalSettings() {
    if (!Riptide.Terminal || !Riptide.Terminal.instances) return;
    for (const [, group] of Riptide.Terminal.instances) {
      for (const [, inst] of group.subTabs) {
        const term = inst.term;
        if (!term) continue;
        term.options.fontSize = this.get('terminalFontSize');
        term.options.cursorStyle = this.get('cursorStyle');
        term.options.cursorBlink = this.get('cursorBlink');
        term.options.scrollback = this.get('scrollbackLines');
        if (inst.fitAddon) {
          inst.fitAddon.fit();
        }
      }
    }
  },

  applyAll() {
    this._applyTerminalSettings();
    if (Riptide.Recorder) {
      Riptide.Recorder._autoRecord = this.get('autoRecord');
    }
  },

  // ── Modal lifecycle ──────────────────────────────────────────────

  open() {
    if (this._overlay) return;
    this._activeCategory = 'general';
    this._overlay = this._buildOverlay();
    document.body.appendChild(this._overlay);
    // Animate in
    requestAnimationFrame(() => {
      this._overlay.classList.add('visible');
    });
  },

  _close() {
    if (!this._overlay) return;
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    this._overlay.classList.remove('visible');
    setTimeout(() => {
      if (this._overlay && this._overlay.parentNode) {
        this._overlay.parentNode.removeChild(this._overlay);
      }
      this._overlay = null;
    }, 200);
  },

  // ── Build the full overlay ───────────────────────────────────────

  _buildOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._close();
    });

    const popup = document.createElement('div');
    popup.className = 'settings-popup';

    // Header
    const header = document.createElement('div');
    header.className = 'settings-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'settings-header-title';
    const icon = document.createElement('span');
    icon.textContent = '\u2699';
    icon.style.marginRight = '8px';
    const titleText = document.createElement('span');
    titleText.textContent = 'Settings';
    titleWrap.appendChild(icon);
    titleWrap.appendChild(titleText);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'settings-close-btn';
    closeBtn.textContent = '\u2715';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this._close());

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    // Body = sidebar + content
    const body = document.createElement('div');
    body.className = 'settings-body';

    const sidebar = this._buildSidebar();
    const content = document.createElement('div');
    content.className = 'settings-content';
    content.id = 'settings-content-pane';

    body.appendChild(sidebar);
    body.appendChild(content);

    popup.appendChild(header);
    popup.appendChild(body);
    overlay.appendChild(popup);

    // Render initial category
    this._renderCategory('general', content);

    // Keyboard: Escape closes
    this._keyHandler = (e) => {
      if (e.key === 'Escape') {
        if (!document.getElementById('modal-overlay').classList.contains('hidden')) return;
        e.stopPropagation();
        this._close();
        document.removeEventListener('keydown', this._keyHandler, true);
      }
    };
    document.addEventListener('keydown', this._keyHandler, true);

    return overlay;
  },

  // ── Sidebar navigation ──────────────────────────────────────────

  _buildSidebar() {
    const sidebar = document.createElement('div');
    sidebar.className = 'settings-sidebar';

    const categories = [
      { id: 'general', label: 'General', icon: '\u2302' },
      { id: 'terminal', label: 'Terminal', icon: '>' },
      { id: 'editor', label: 'Editor', icon: '\u270E' },
      { id: 'room', label: 'Room', icon: '\u2691' },
      { id: 'about', label: 'About', icon: '\u2139' },
    ];

    for (const cat of categories) {
      const item = document.createElement('div');
      item.className = 'settings-nav-item' + (cat.id === this._activeCategory ? ' active' : '');
      item.dataset.category = cat.id;

      const iconSpan = document.createElement('span');
      iconSpan.className = 'settings-nav-icon';
      iconSpan.textContent = cat.icon;

      const labelSpan = document.createElement('span');
      labelSpan.textContent = cat.label;

      item.appendChild(iconSpan);
      item.appendChild(labelSpan);

      item.addEventListener('click', () => {
        this._activeCategory = cat.id;
        sidebar.querySelectorAll('.settings-nav-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        const pane = document.getElementById('settings-content-pane');
        if (pane) this._renderCategory(cat.id, pane);
      });

      sidebar.appendChild(item);
    }

    return sidebar;
  },

  // ── Category rendering ──────────────────────────────────────────

  _renderCategory(catId, container) {
    // Clear previous content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    switch (catId) {
      case 'general':
        this._buildGeneralPane(container);
        break;
      case 'terminal':
        this._buildTerminalPane(container);
        break;
      case 'editor':
        this._buildEditorPane(container);
        break;
      case 'room':
        this._buildRoomPane(container);
        break;
      case 'about':
        this._buildAboutPane(container);
        break;
    }
  },

  // ── General ─────────────────────────────────────────────────────

  _buildGeneralPane(container) {
    const title = document.createElement('h3');
    title.className = 'settings-section-title';
    title.textContent = 'General';
    container.appendChild(title);

    const section = document.createElement('div');
    section.className = 'settings-section';

    // Theme dropdown (uses Riptide.Theme instead of settings store)
    const themeRow = document.createElement('div');
    themeRow.className = 'settings-row';

    const themeLeft = document.createElement('div');
    themeLeft.className = 'settings-row-left';

    const themeLabel = document.createElement('span');
    themeLabel.className = 'settings-label';
    themeLabel.textContent = 'Theme';
    themeLeft.appendChild(themeLabel);

    const themeDesc = document.createElement('span');
    themeDesc.className = 'settings-desc';
    themeDesc.textContent = 'Catppuccin color scheme';
    themeLeft.appendChild(themeDesc);

    const themeSelect = document.createElement('select');
    themeSelect.className = 'settings-select';

    const themeOptions = [
      { value: 'macchiato', label: 'Macchiato (default)' },
      { value: 'mocha', label: 'Mocha' },
      { value: 'frappe', label: 'Frappe' },
      { value: 'latte', label: 'Latte' }
    ];

    const currentTheme = Riptide.Theme.current;

    for (const opt of themeOptions) {
      const optEl = document.createElement('option');
      optEl.value = opt.value;
      optEl.textContent = opt.label;
      if (opt.value === currentTheme) {
        optEl.selected = true;
      }
      themeSelect.appendChild(optEl);
    }

    themeSelect.addEventListener('change', () => {
      Riptide.Theme.apply(themeSelect.value);
    });

    themeRow.appendChild(themeLeft);
    themeRow.appendChild(themeSelect);
    section.appendChild(themeRow);

    section.appendChild(this._buildToggle('Auto-record sessions', 'autoRecord',
      'Automatically start recording terminal output when switching tabs'));

    section.appendChild(this._buildDropdown('Timestamp format', 'timestampFormat', [
      { value: '24h', label: '24-hour' },
      { value: '12h', label: '12-hour' },
    ], 'Format used for timestamps in history and audit log'));

    container.appendChild(section);
  },

  // ── Terminal ────────────────────────────────────────────────────

  _buildTerminalPane(container) {
    const title = document.createElement('h3');
    title.className = 'settings-section-title';
    title.textContent = 'Terminal';
    container.appendChild(title);

    const section = document.createElement('div');
    section.className = 'settings-section';

    section.appendChild(this._buildNumberInput('Font size', 'terminalFontSize', 10, 24, 1,
      'Terminal font size in pixels'));

    section.appendChild(this._buildSegmented('Cursor style', 'cursorStyle', [
      { value: 'block', label: 'Block' },
      { value: 'underline', label: 'Underline' },
      { value: 'bar', label: 'Bar' },
    ], 'Shape of the terminal cursor'));

    section.appendChild(this._buildToggle('Cursor blink', 'cursorBlink',
      'Whether the terminal cursor blinks'));

    section.appendChild(this._buildNumberInput('Scrollback lines', 'scrollbackLines', 100, 10000, 100,
      'Number of lines kept in terminal scroll history'));

    container.appendChild(section);
  },

  // ── Editor ──────────────────────────────────────────────────────

  _buildEditorPane(container) {
    const title = document.createElement('h3');
    title.className = 'settings-section-title';
    title.textContent = 'Editor';
    container.appendChild(title);

    const section = document.createElement('div');
    section.className = 'settings-section';

    section.appendChild(this._buildNumberInput('Font size', 'editorFontSize', 10, 24, 1,
      'Playbook editor font size in pixels'));

    container.appendChild(section);
  },

  // ── Room ────────────────────────────────────────────────────────

  _buildRoomPane(container) {
    const title = document.createElement('h3');
    title.className = 'settings-section-title';
    title.textContent = 'Room';
    container.appendChild(title);

    // Room info section
    const infoSection = document.createElement('div');
    infoSection.className = 'settings-section';

    const nameRow = document.createElement('div');
    nameRow.className = 'settings-row';

    const nameLabel = document.createElement('div');
    nameLabel.className = 'settings-row-left';
    const nameLabelText = document.createElement('span');
    nameLabelText.className = 'settings-label';
    nameLabelText.textContent = 'Room name';
    const nameDesc = document.createElement('span');
    nameDesc.className = 'settings-desc';
    nameDesc.textContent = Riptide.Auth.roomName || 'Unknown';
    nameLabel.appendChild(nameLabelText);
    nameLabel.appendChild(nameDesc);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'settings-room-rename-btn';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => this._renameRoom(nameDesc));

    nameRow.appendChild(nameLabel);
    nameRow.appendChild(renameBtn);
    infoSection.appendChild(nameRow);

    // Archive row
    const archiveRow = document.createElement('div');
    archiveRow.className = 'settings-row';

    const archiveLabel = document.createElement('div');
    archiveLabel.className = 'settings-row-left';
    const archiveLabelText = document.createElement('span');
    archiveLabelText.className = 'settings-label';
    const isCurrentlyArchived = Riptide.Auth.isArchived(Riptide.Auth.roomId);
    archiveLabelText.textContent = isCurrentlyArchived ? 'Unarchive room' : 'Archive room';
    const archiveDesc = document.createElement('span');
    archiveDesc.className = 'settings-desc';
    archiveDesc.textContent = isCurrentlyArchived
      ? 'This room is archived. Unarchive to show it on the login screen.'
      : 'Hide this room from the login screen. You can still access it by showing archived rooms.';
    archiveLabel.appendChild(archiveLabelText);
    archiveLabel.appendChild(archiveDesc);

    const archiveBtn = document.createElement('button');
    archiveBtn.className = 'settings-room-rename-btn';
    archiveBtn.textContent = isCurrentlyArchived ? 'Unarchive' : 'Archive';
    archiveBtn.addEventListener('click', () => {
      const nowArchived = !Riptide.Auth.isArchived(Riptide.Auth.roomId);
      Riptide.Auth.setArchived(Riptide.Auth.roomId, nowArchived);
      Riptide.toast(nowArchived ? 'Room archived. It will be hidden on the login screen.' : 'Room unarchived.');
      // Re-render the pane to update button state
      this._renderCategory('room', container);
    });

    archiveRow.appendChild(archiveLabel);
    archiveRow.appendChild(archiveBtn);
    infoSection.appendChild(archiveRow);

    container.appendChild(infoSection);

    // Export / Import section
    const exportTitle = document.createElement('h3');
    exportTitle.className = 'settings-section-title';
    exportTitle.textContent = 'Engagement Data';
    exportTitle.style.marginTop = '24px';
    container.appendChild(exportTitle);

    const exportSection = document.createElement('div');
    exportSection.className = 'settings-section';

    // Export row
    const exportRow = document.createElement('div');
    exportRow.className = 'settings-row';

    const exportLabel = document.createElement('div');
    exportLabel.className = 'settings-row-left';
    const exportLabelText = document.createElement('span');
    exportLabelText.className = 'settings-label';
    exportLabelText.textContent = 'Export engagement';
    const exportDesc = document.createElement('span');
    exportDesc.className = 'settings-desc';
    exportDesc.textContent = 'Download all room data (tabs, playbooks, credentials, notes) as a zip file.';
    exportLabel.appendChild(exportLabelText);
    exportLabel.appendChild(exportDesc);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'settings-room-rename-btn';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', () => this._exportRoom());

    exportRow.appendChild(exportLabel);
    exportRow.appendChild(exportBtn);
    exportSection.appendChild(exportRow);

    // Import row
    const importRow = document.createElement('div');
    importRow.className = 'settings-row';

    const importLabel = document.createElement('div');
    importLabel.className = 'settings-row-left';
    const importLabelText = document.createElement('span');
    importLabelText.className = 'settings-label';
    importLabelText.textContent = 'Import engagement';
    const importDesc = document.createElement('span');
    importDesc.className = 'settings-desc';
    importDesc.textContent = 'Upload a previously exported zip to restore data into this room. Existing data will be overwritten.';
    importLabel.appendChild(importLabelText);
    importLabel.appendChild(importDesc);

    const importBtn = document.createElement('button');
    importBtn.className = 'settings-room-rename-btn';
    importBtn.textContent = 'Import';
    importBtn.addEventListener('click', () => this._importRoom());

    importRow.appendChild(importLabel);
    importRow.appendChild(importBtn);
    exportSection.appendChild(importRow);

    // Report row
    const reportRow = document.createElement('div');
    reportRow.className = 'settings-row';

    const reportLabel = document.createElement('div');
    reportLabel.className = 'settings-row-left';
    const reportLabelText = document.createElement('span');
    reportLabelText.className = 'settings-label';
    reportLabelText.textContent = 'Generate report';
    const reportDesc = document.createElement('span');
    reportDesc.className = 'settings-desc';
    reportDesc.textContent = 'Download a structured markdown report of all engagement data (playbooks, credentials, history, findings).';
    reportLabel.appendChild(reportLabelText);
    reportLabel.appendChild(reportDesc);

    const reportBtn = document.createElement('button');
    reportBtn.className = 'settings-room-rename-btn';
    reportBtn.textContent = 'Report';
    reportBtn.addEventListener('click', () => this._generateReport());

    reportRow.appendChild(reportLabel);
    reportRow.appendChild(reportBtn);
    exportSection.appendChild(reportRow);

    container.appendChild(exportSection);

    // Danger zone
    const dangerTitle = document.createElement('h3');
    dangerTitle.className = 'settings-section-title';
    dangerTitle.textContent = 'Danger Zone';
    dangerTitle.style.marginTop = '24px';
    container.appendChild(dangerTitle);

    const dangerSection = document.createElement('div');
    dangerSection.className = 'settings-danger-zone';

    const dangerRow = document.createElement('div');
    dangerRow.className = 'settings-row';

    const dangerLabel = document.createElement('div');
    dangerLabel.className = 'settings-row-left';
    const dangerLabelText = document.createElement('span');
    dangerLabelText.className = 'settings-label';
    dangerLabelText.textContent = 'Delete room';
    const dangerDesc = document.createElement('span');
    dangerDesc.className = 'settings-desc';
    dangerDesc.textContent = 'Permanently delete this room and all its data. This cannot be undone.';
    dangerLabel.appendChild(dangerLabelText);
    dangerLabel.appendChild(dangerDesc);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'settings-danger-btn';
    deleteBtn.textContent = 'Delete Room';
    deleteBtn.addEventListener('click', () => this._deleteRoom());

    dangerRow.appendChild(dangerLabel);
    dangerRow.appendChild(deleteBtn);
    dangerSection.appendChild(dangerRow);
    container.appendChild(dangerSection);
  },

  // ── About ───────────────────────────────────────────────────────

  _buildAboutPane(container) {
    const title = document.createElement('h3');
    title.className = 'settings-section-title';
    title.textContent = 'About';
    container.appendChild(title);

    const section = document.createElement('div');
    section.className = 'settings-section';

    // App name
    const appRow = document.createElement('div');
    appRow.className = 'settings-row';
    const appLabel = document.createElement('span');
    appLabel.className = 'settings-label';
    appLabel.textContent = 'Application';
    const appValue = document.createElement('span');
    appValue.className = 'settings-value';
    appValue.textContent = 'Riptide';
    appRow.appendChild(appLabel);
    appRow.appendChild(appValue);
    section.appendChild(appRow);

    // Version
    const verRow = document.createElement('div');
    verRow.className = 'settings-row';
    const verLabel = document.createElement('span');
    verLabel.className = 'settings-label';
    verLabel.textContent = 'Version';
    const verValue = document.createElement('span');
    verValue.className = 'settings-value';
    verValue.textContent = '1.0.0';
    verRow.appendChild(verLabel);
    verRow.appendChild(verValue);
    section.appendChild(verRow);

    container.appendChild(section);

    // Shortcuts button
    const shortcutsBtn = document.createElement('button');
    shortcutsBtn.className = 'settings-about-btn';
    shortcutsBtn.textContent = 'Keyboard Shortcuts';
    shortcutsBtn.style.marginTop = '16px';
    shortcutsBtn.addEventListener('click', () => {
      this._close();
      setTimeout(() => {
        if (Riptide.Shortcuts && Riptide.Shortcuts.showReference) {
          Riptide.Shortcuts.showReference();
        }
      }, 250);
    });
    container.appendChild(shortcutsBtn);
  },

  // ── Room operations (migrated from app.js) ─────────────────────

  async _renameRoom(nameDescEl) {
    const name = await Riptide.Modal.prompt('New room name', Riptide.Auth.roomName);
    if (!name) return;

    try {
      await Riptide.api(`/api/rooms/${encodeURIComponent(Riptide.Auth.roomId)}`, {
        method: 'PATCH',
        body: { name }
      });
      Riptide.Auth.roomName = name;
      // Update the room badge in the toolbar
      const roomNameEl = document.getElementById('room-name');
      if (roomNameEl) {
        roomNameEl.textContent = name;
      }
      // Update the description text in the settings pane
      if (nameDescEl) {
        nameDescEl.textContent = name;
      }
    } catch (err) {
      await Riptide.Modal.alert('Error', err.message);
    }
  },

  async _deleteRoom() {
    const confirmed = await Riptide.Modal.confirm(
      'Delete Room',
      'Permanently delete "' + (Riptide.Auth.roomName || '') + '"? All tabs, playbooks, and terminals will be destroyed. This cannot be undone.'
    );
    if (!confirmed) return;

    try {
      await Riptide.api(`/api/rooms/${encodeURIComponent(Riptide.Auth.roomId)}`, {
        method: 'DELETE'
      });
      Riptide.Auth.token = null;
      sessionStorage.removeItem('cw_token');
      location.reload();
    } catch (err) {
      await Riptide.Modal.alert('Error', err.message);
    }
  },

  async _exportRoom() {
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(Riptide.Auth.roomId)}/export`, {
        headers: { 'Authorization': 'Bearer ' + Riptide.Auth.token }
      });
      if (!res.ok) {
        let msg = 'Export failed';
        try { const err = await res.json(); msg = err.error || msg; } catch { /* non-JSON response */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+)"/);
      a.download = match ? match[1] : 'engagement-export.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      await Riptide.Modal.alert('Export Error', err.message);
    }
  },

  async _importRoom() {
    const confirmed = await Riptide.Modal.confirm(
      'Import Engagement',
      'This will overwrite existing room data with the contents of the uploaded zip. Continue?'
    );
    if (!confirmed) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;

      try {
        const buffer = await file.arrayBuffer();
        const res = await fetch(`/api/rooms/${encodeURIComponent(Riptide.Auth.roomId)}/import`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + Riptide.Auth.token,
            'Content-Type': 'application/octet-stream'
          },
          body: buffer
        });
        if (!res.ok) {
          let msg = 'Import failed';
          try { const err = await res.json(); msg = err.error || msg; } catch { /* non-JSON response */ }
          throw new Error(msg);
        }
        await Riptide.Modal.alert('Import Complete', 'Engagement data imported successfully. The page will reload.');
        location.reload();
      } catch (err) {
        await Riptide.Modal.alert('Import Error', err.message);
      }
    });
    input.click();
  },

  async _generateReport() {
    const choice = await Riptide.Modal.choose(
      'Include credentials?',
      'Credentials (usernames/passwords) can be included or redacted in the report.',
      'Include credentials',
      'Redact credentials'
    );
    if (choice === null) return;
    const includeCreds = choice === 'a';

    try {
      const params = new URLSearchParams();
      if (!includeCreds) params.set('includeCredentials', 'false');
      const url = `/api/rooms/${encodeURIComponent(Riptide.Auth.roomId)}/report?${params}`;
      const res = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + Riptide.Auth.token }
      });
      if (!res.ok) {
        let msg = 'Report generation failed';
        try { const err = await res.json(); msg = err.error || msg; } catch { /* non-JSON response */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+)"/);
      a.download = match ? match[1] : 'engagement-report.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      Riptide.toast('Report downloaded');
    } catch (err) {
      await Riptide.Modal.alert('Report Error', err.message);
    }
  },

  // ── Widget builders ─────────────────────────────────────────────

  _buildToggle(label, key, description) {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const left = document.createElement('div');
    left.className = 'settings-row-left';

    const labelEl = document.createElement('span');
    labelEl.className = 'settings-label';
    labelEl.textContent = label;
    left.appendChild(labelEl);

    if (description) {
      const desc = document.createElement('span');
      desc.className = 'settings-desc';
      desc.textContent = description;
      left.appendChild(desc);
    }

    const toggle = document.createElement('label');
    toggle.className = 'settings-toggle';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.get(key);
    input.addEventListener('change', () => this.set(key, input.checked));

    const slider = document.createElement('span');
    slider.className = 'settings-toggle-slider';

    toggle.appendChild(input);
    toggle.appendChild(slider);

    row.appendChild(left);
    row.appendChild(toggle);
    return row;
  },

  _buildNumberInput(label, key, min, max, step, description) {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const left = document.createElement('div');
    left.className = 'settings-row-left';

    const labelEl = document.createElement('span');
    labelEl.className = 'settings-label';
    labelEl.textContent = label;
    left.appendChild(labelEl);

    if (description) {
      const desc = document.createElement('span');
      desc.className = 'settings-desc';
      desc.textContent = description;
      left.appendChild(desc);
    }

    const controls = document.createElement('div');
    controls.className = 'settings-number';

    const minusBtn = document.createElement('button');
    minusBtn.className = 'settings-number-btn';
    minusBtn.textContent = '\u2212';
    minusBtn.title = 'Decrease';

    const valueSpan = document.createElement('span');
    valueSpan.className = 'settings-number-value';
    valueSpan.textContent = this.get(key);

    const plusBtn = document.createElement('button');
    plusBtn.className = 'settings-number-btn';
    plusBtn.textContent = '+';
    plusBtn.title = 'Increase';

    const updateValue = (newVal) => {
      const clamped = Math.max(min, Math.min(max, newVal));
      valueSpan.textContent = clamped;
      this.set(key, clamped);
    };

    minusBtn.addEventListener('click', () => {
      updateValue(this.get(key) - step);
    });

    plusBtn.addEventListener('click', () => {
      updateValue(this.get(key) + step);
    });

    controls.appendChild(minusBtn);
    controls.appendChild(valueSpan);
    controls.appendChild(plusBtn);

    row.appendChild(left);
    row.appendChild(controls);
    return row;
  },

  _buildSegmented(label, key, options, description) {
    const row = document.createElement('div');
    row.className = 'settings-row settings-row-stacked';

    const left = document.createElement('div');
    left.className = 'settings-row-left';

    const labelEl = document.createElement('span');
    labelEl.className = 'settings-label';
    labelEl.textContent = label;
    left.appendChild(labelEl);

    if (description) {
      const desc = document.createElement('span');
      desc.className = 'settings-desc';
      desc.textContent = description;
      left.appendChild(desc);
    }

    const segmented = document.createElement('div');
    segmented.className = 'settings-segmented';

    const currentValue = this.get(key);

    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = 'settings-seg-btn' + (opt.value === currentValue ? ' active' : '');
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        segmented.querySelectorAll('.settings-seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.set(key, opt.value);
      });
      segmented.appendChild(btn);
    }

    row.appendChild(left);
    row.appendChild(segmented);
    return row;
  },

  _buildDropdown(label, key, options, description) {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const left = document.createElement('div');
    left.className = 'settings-row-left';

    const labelEl = document.createElement('span');
    labelEl.className = 'settings-label';
    labelEl.textContent = label;
    left.appendChild(labelEl);

    if (description) {
      const desc = document.createElement('span');
      desc.className = 'settings-desc';
      desc.textContent = description;
      left.appendChild(desc);
    }

    const select = document.createElement('select');
    select.className = 'settings-select';

    const currentValue = this.get(key);

    for (const opt of options) {
      const optEl = document.createElement('option');
      optEl.value = opt.value;
      optEl.textContent = opt.label;
      if (opt.value === currentValue) {
        optEl.selected = true;
      }
      select.appendChild(optEl);
    }

    select.addEventListener('change', () => {
      this.set(key, select.value);
    });

    row.appendChild(left);
    row.appendChild(select);
    return row;
  },
};
