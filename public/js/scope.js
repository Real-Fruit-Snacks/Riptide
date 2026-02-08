window.Riptide = window.Riptide || {};

Riptide.Scope = {
  _panel: null,
  _scope: {},
  _saveTimeout: null,

  _fields: [
    { key: 'ip', label: 'IP', placeholder: 'e.g. 10.10.10.1' },
    { key: 'hostname', label: 'Host', placeholder: 'e.g. target.htb' },
    { key: 'os', label: 'OS', placeholder: 'e.g. Linux, Windows 10' },
    { key: 'ports', label: 'Ports', placeholder: 'e.g. 22/ssh, 80/http, 443/https' },
    { key: 'services', label: 'Services', placeholder: 'e.g. Apache 2.4, OpenSSH 8.2' },
    { key: 'notes', label: 'Notes', placeholder: 'Target notes...' }
  ],

  init() {
    this._panel = Riptide.CollapsiblePanel.create({
      sectionId: 'scope-section',
      listId: 'scope-list',
      headerId: 'scope-header',
      chevronClass: 'scope-chevron',
      badgeClass: 'scope-badge',
      label: 'Target Scope',
      startExpanded: false
    });
  },

  load(tabId) {
    if (!tabId) {
      this._scope = {};
      this._render();
      return;
    }
    const tab = Riptide.Tabs.tabs.find(t => t.id === tabId);
    this._scope = (tab && tab.scope) ? { ...tab.scope } : {};
    this._render();
  },

  _render() {
    this._panel.list.innerHTML = '';
    this._updateBadge();

    for (const field of this._fields) {
      const row = document.createElement('div');
      row.className = 'scope-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'scope-label';
      labelEl.textContent = field.label;

      const input = document.createElement('input');
      input.className = 'scope-input';
      input.type = 'text';
      input.placeholder = field.placeholder;
      input.value = this._scope[field.key] || '';
      input.spellcheck = false;

      input.addEventListener('input', () => {
        this._onFieldChange(field.key, input.value);
        // Re-render port chips if ports field changed
        if (field.key === 'ports') {
          this._renderPortChips(row, input.value);
        }
      });

      row.appendChild(labelEl);
      row.appendChild(input);
      this._panel.list.appendChild(row);

      // Render port chips below ports input
      if (field.key === 'ports' && this._scope.ports) {
        this._renderPortChips(row, this._scope.ports);
      }
    }

    // Flag sections
    this._renderFlagSection('userFlags', 'User Flags');
    this._renderFlagSection('rootFlags', 'Root Flags');
  },

  _renderPortChips(row, portsStr) {
    // Remove existing chip container from this row
    const existing = row.querySelector('.scope-port-chips');
    if (existing) existing.remove();

    if (!portsStr || !portsStr.trim()) return;

    const chips = portsStr.split(',').map(s => s.trim()).filter(Boolean);
    if (chips.length === 0) return;

    const container = document.createElement('div');
    container.className = 'scope-port-chips';

    for (const chipText of chips) {
      const chip = document.createElement('span');
      chip.className = 'scope-port-chip';

      const text = document.createElement('span');
      text.className = 'scope-port-chip-text';
      text.textContent = chipText;
      text.title = 'Click to copy port number';
      text.addEventListener('click', () => {
        // Extract just the port number (before any /)
        const portNum = chipText.split('/')[0].trim();
        this._copyToClipboard(portNum, 'Port ' + portNum);
      });

      const removeBtn = document.createElement('span');
      removeBtn.className = 'scope-port-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove port';
      removeBtn.addEventListener('click', () => {
        const updated = chips.filter(c => c !== chipText).join(', ');
        this._scope.ports = updated;
        // Update the input field
        const input = row.querySelector('.scope-input');
        if (input) input.value = updated;
        this._onFieldChange('ports', updated);
        this._renderPortChips(row, updated);
      });

      chip.appendChild(text);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    }

    row.appendChild(container);
  },

  _renderFlagSection(key, label) {
    const section = document.createElement('div');
    section.className = 'scope-flag-section';

    const header = document.createElement('div');
    header.className = 'scope-flag-header';

    const labelEl = document.createElement('span');
    labelEl.className = 'scope-label';
    labelEl.textContent = label;

    const addBtn = document.createElement('button');
    addBtn.className = 'scope-flag-add';
    addBtn.textContent = '+';
    addBtn.title = 'Add ' + label.toLowerCase().slice(0, -1);
    addBtn.addEventListener('click', async () => {
      const flag = await Riptide.Modal.prompt(label.slice(0, -1), '');
      if (flag !== null && flag.trim()) {
        if (!this._scope[key]) this._scope[key] = [];
        this._scope[key].push(flag.trim());
        this._onFieldChange(key, this._scope[key]);
        this._render();
        this._notifyFlag(key, flag.trim());
      }
    });

    header.appendChild(labelEl);
    header.appendChild(addBtn);
    section.appendChild(header);

    const flags = this._scope[key] || [];
    if (flags.length > 0) {
      const chips = document.createElement('div');
      chips.className = 'scope-flag-chips';

      for (let i = 0; i < flags.length; i++) {
        const chip = document.createElement('span');
        chip.className = key === 'rootFlags' ? 'scope-flag-chip root-flag' : 'scope-flag-chip';
        chip.title = 'Click to copy flag';

        const text = document.createElement('span');
        text.className = 'scope-flag-chip-text';
        // Show truncated flag for display
        const displayVal = flags[i].length > 24 ? flags[i].substring(0, 24) + '...' : flags[i];
        text.textContent = displayVal;
        text.addEventListener('click', () => {
          this._copyToClipboard(flags[i], label.slice(0, -1));
        });

        const removeBtn = document.createElement('span');
        removeBtn.className = 'scope-flag-chip-remove';
        removeBtn.textContent = '\u00d7';
        removeBtn.title = 'Remove flag';
        const idx = i;
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._scope[key].splice(idx, 1);
          if (this._scope[key].length === 0) delete this._scope[key];
          this._onFieldChange(key, this._scope[key] || []);
          this._render();
        });

        chip.appendChild(text);
        chip.appendChild(removeBtn);
        chips.appendChild(chip);
      }

      section.appendChild(chips);
    }

    this._panel.list.appendChild(section);
  },

  _onFieldChange(key, value) {
    if (!Array.isArray(value)) {
      this._scope[key] = value;
    }

    // Sync IP and hostname to variables
    if (key === 'ip') {
      this._syncVariable('TargetIP', value);
    } else if (key === 'hostname') {
      this._syncVariable('Domain', value);
    }

    this._updateBadge();

    // Debounced save
    clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      this._save();
    }, 500);
  },

  _syncVariable(name, value) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;
    const tab = Riptide.Tabs.getActiveTab();
    if (!tab.variables) tab.variables = {};
    tab.variables[name] = value;
    Riptide.Tabs.setTabVariables(tabId, tab.variables);
    Riptide.Variables.refresh();
  },

  async _save() {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;
    try {
      await Riptide.api('/api/tabs/' + encodeURIComponent(tabId), {
        method: 'PATCH',
        body: { scope: this._scope }
      });
    } catch {
      Riptide.toast('Failed to save scope');
    }
  },

  // Called by sync when remote user updates scope
  onScopeChanged(scope) {
    this._scope = scope || {};
    this._render();
  },

  _updateBadge() {
    let filled = 0;
    let total = this._fields.length;
    for (const field of this._fields) {
      if (typeof this._scope[field.key] === 'string' && this._scope[field.key].trim()) {
        filled++;
      }
    }
    // Count flags
    const userFlags = this._scope.userFlags || [];
    const rootFlags = this._scope.rootFlags || [];
    const flagCount = userFlags.length + rootFlags.length;
    if (flagCount > 0) {
      filled += flagCount;
      total += flagCount;
    }
    if (filled > 0) {
      this._panel.badge.textContent = filled + '/' + total;
      this._panel.badge.style.display = '';
    } else {
      this._panel.badge.textContent = '';
      this._panel.badge.style.display = 'none';
    }
  },

  _notifyFlag(key, value) {
    const tabName = Riptide.Tabs ? (Riptide.Tabs.getActiveTab() || {}).name || 'Unknown' : 'Unknown';
    const flagType = key === 'rootFlags' ? 'Root Flag' : 'User Flag';
    const context = key === 'rootFlags' ? 'root-flag' : 'user-flag';
    const preview = value.length > 60 ? value.substring(0, 60) + '...' : value;

    Riptide.Alerts.flag(context, flagType + ' — ' + tabName, preview, flagType + ' submitted to team');
  },

  _copyToClipboard(text, label) {
    Riptide.clipboard(text, label);
  }
};
