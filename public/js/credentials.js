window.Riptide = window.Riptide || {};

Riptide.Credentials = {
  _panel: null,
  _addBtn: null,
  entries: [],
  globalEntries: [],

  init() {
    this._panel = Riptide.CollapsiblePanel.create({
      sectionId: 'credentials-section',
      listId: 'credentials-list',
      headerId: 'credentials-header',
      chevronClass: 'cred-chevron',
      badgeClass: 'cred-badge',
      label: 'Credentials'
    });

    // Export button
    this._exportBtn = document.createElement('button');
    this._exportBtn.className = 'cred-export-btn';
    this._exportBtn.innerHTML = '&#8615;';
    this._exportBtn.title = 'Export credentials';
    this._exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._exportCredentials();
    });

    // Add button
    this._addBtn = document.createElement('button');
    this._addBtn.className = 'cred-add-btn';
    this._addBtn.textContent = '+';
    this._addBtn.title = 'Add credential';
    this._addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showForm();
    });

    this._panel.header.appendChild(this._exportBtn);
    this._panel.header.appendChild(this._addBtn);
  },

  async load(tabId) {
    // Load tab-specific credentials
    if (!tabId) { this.entries = []; } else {
      try {
        this.entries = await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/credentials`);
      } catch {
        this.entries = [];
      }
    }
    // Always load global credentials
    try {
      this.globalEntries = await Riptide.api('/api/credentials');
    } catch {
      this.globalEntries = [];
    }
    this._render();
  },

  async addCredential(data, scope = 'tab') {
    if (scope === 'global') {
      try {
        const result = await Riptide.api('/api/credentials', {
          method: 'POST',
          body: data
        });
        this.globalEntries.push(result.credential);
        this._render();
      } catch {
        Riptide.toast('Failed to save credential');
      }
      return;
    }
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;
    try {
      const result = await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/credentials`, {
        method: 'POST',
        body: data
      });
      this.entries.push(result.credential);
      this._render();
    } catch {
      Riptide.toast('Failed to save credential');
    }
  },

  async updateCredential(id, data, scope = 'tab') {
    if (scope === 'global') {
      try {
        const result = await Riptide.api(`/api/credentials/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: data
        });
        const idx = this.globalEntries.findIndex(e => e.id === id);
        if (idx !== -1) this.globalEntries[idx] = result.credential;
        this._render();
      } catch {
        Riptide.toast('Failed to update credential');
      }
      return;
    }
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;
    try {
      const result = await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/credentials/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: data
      });
      const idx = this.entries.findIndex(e => e.id === id);
      if (idx !== -1) this.entries[idx] = result.credential;
      this._render();
    } catch {
      Riptide.toast('Failed to update credential');
    }
  },

  async deleteCredential(id, scope = 'tab') {
    if (scope === 'global') {
      try {
        await Riptide.api(`/api/credentials/${encodeURIComponent(id)}`, {
          method: 'DELETE'
        });
        this.globalEntries = this.globalEntries.filter(e => e.id !== id);
        this._render();
      } catch {
        Riptide.toast('Failed to delete credential');
      }
      return;
    }
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;
    try {
      await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/credentials/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      this.entries = this.entries.filter(e => e.id !== id);
      this._render();
    } catch {
      Riptide.toast('Failed to delete credential');
    }
  },

  // Called by sync when remote events arrive
  addEntry(credential) {
    this.entries.push(credential);
    this._render();
  },

  updateEntry(credential) {
    const idx = this.entries.findIndex(e => e.id === credential.id);
    if (idx !== -1) {
      this.entries[idx] = credential;
    } else {
      this.entries.push(credential);
    }
    this._render();
  },

  removeEntry(credentialId) {
    this.entries = this.entries.filter(e => e.id !== credentialId);
    this._render();
  },

  addGlobalEntry(credential) {
    this.globalEntries.push(credential);
    this._render();
  },

  updateGlobalEntry(credential) {
    const idx = this.globalEntries.findIndex(e => e.id === credential.id);
    if (idx !== -1) {
      this.globalEntries[idx] = credential;
    } else {
      this.globalEntries.push(credential);
    }
    this._render();
  },

  removeGlobalEntry(credentialId) {
    this.globalEntries = this.globalEntries.filter(e => e.id !== credentialId);
    this._render();
  },

  _render() {
    this._panel.list.innerHTML = '';
    const allEntries = [
      ...this.globalEntries.map(e => ({ ...e, _scope: 'global' })),
      ...this.entries.map(e => ({ ...e, _scope: 'tab' }))
    ];
    this._panel.badge.textContent = allEntries.length > 0 ? allEntries.length : '';

    if (allEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cred-empty';
      empty.textContent = 'No credentials stored. Click + to add.';
      this._panel.list.appendChild(empty);
      return;
    }

    // Table
    const table = document.createElement('table');
    table.className = 'cred-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Scope', 'Service', 'Username', 'Password', 'Hash', 'Notes', ''].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const entry of allEntries) {
      const row = document.createElement('tr');
      if (entry._scope === 'global') row.classList.add('cred-row-global');

      // Scope indicator
      const tdScope = document.createElement('td');
      tdScope.className = 'cred-cell-scope';
      const scopeBadge = document.createElement('span');
      scopeBadge.className = `cred-scope-badge cred-scope-${entry._scope}`;
      scopeBadge.textContent = entry._scope === 'global' ? 'G' : 'T';
      scopeBadge.title = entry._scope === 'global' ? 'Global (all tabs)' : 'Tab-specific';
      tdScope.appendChild(scopeBadge);
      row.appendChild(tdScope);

      // Service
      const tdService = document.createElement('td');
      tdService.textContent = entry.service || '';
      tdService.className = 'cred-cell-service';
      row.appendChild(tdService);

      // Username - clickable to copy
      const tdUser = document.createElement('td');
      tdUser.className = 'cred-cell-user';
      const userSpan = document.createElement('span');
      userSpan.className = 'cred-copyable';
      userSpan.textContent = entry.username || '';
      userSpan.title = 'Click to copy';
      userSpan.addEventListener('click', () => this._copyToClipboard(entry.username || '', 'Username'));
      tdUser.appendChild(userSpan);
      row.appendChild(tdUser);

      // Password - click to reveal, click again to copy & re-blur
      const tdPass = document.createElement('td');
      tdPass.className = 'cred-cell-secret';
      if (entry.password) {
        const passText = document.createElement('span');
        passText.className = 'cred-secret-text masked';
        passText.textContent = entry.password;
        passText.title = 'Click to reveal';
        passText.addEventListener('click', () => {
          this._handleSecretClick(passText, entry.password, 'Password');
        });
        tdPass.appendChild(passText);
      }
      row.appendChild(tdPass);

      // Hash - click to reveal, click again to copy & re-blur
      const tdHash = document.createElement('td');
      tdHash.className = 'cred-cell-secret';
      if (entry.hash) {
        const hashText = document.createElement('span');
        hashText.className = 'cred-secret-text masked';
        hashText.textContent = entry.hash;
        hashText.title = 'Click to reveal';
        hashText.addEventListener('click', () => {
          this._handleSecretClick(hashText, entry.hash, 'Hash');
        });
        tdHash.appendChild(hashText);
      }
      row.appendChild(tdHash);

      // Notes
      const tdNotes = document.createElement('td');
      tdNotes.textContent = entry.notes || '';
      tdNotes.className = 'cred-cell-notes';
      row.appendChild(tdNotes);

      // Actions
      const tdActions = document.createElement('td');
      tdActions.className = 'cred-cell-actions';
      const kbBtn = document.createElement('button');
      kbBtn.className = 'cred-action-btn cred-kb-btn';
      kbBtn.title = 'Save to Knowledge Base';
      kbBtn.textContent = 'KB';
      kbBtn.addEventListener('click', () => {
        if (Riptide.Knowledge) {
          const tabName = Riptide.Tabs && Riptide.Tabs.activeTabId
            ? (Riptide.Tabs.tabs.find(t => t.id === Riptide.Tabs.activeTabId) || {}).name || ''
            : '';
          Riptide.Knowledge.saveFromCredential(entry, tabName);
        }
      });
      const editBtn = document.createElement('button');
      editBtn.className = 'cred-action-btn';
      editBtn.innerHTML = '&#9998;';
      editBtn.title = 'Edit';
      editBtn.addEventListener('click', () => this._showForm(entry));
      const delBtn = document.createElement('button');
      delBtn.className = 'cred-action-btn cred-del-btn';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', async () => {
        const confirmed = await Riptide.Modal.confirm(
          'Delete credential',
          `Delete credential for "${entry.service || entry.username || 'this entry'}"?`
        );
        if (confirmed) this.deleteCredential(entry.id, entry._scope);
      });
      const flagBtn = document.createElement('button');
      flagBtn.className = 'cred-action-btn cred-flag-btn';
      flagBtn.innerHTML = '&#9873;';
      flagBtn.title = 'Flag this credential for teammates';
      flagBtn.addEventListener('click', () => {
        const parts = [];
        if (entry.service) parts.push('Service: ' + entry.service);
        if (entry.username) parts.push('User: ' + entry.username);
        if (entry.password) parts.push('Pass: ****');
        if (entry.notes) parts.push('Note: ' + entry.notes);

        Riptide.Alerts.flag('credential', entry.service || 'Credential', parts.join(' | '), 'Credential flagged to teammates');
      });
      tdActions.appendChild(kbBtn);
      tdActions.appendChild(flagBtn);
      tdActions.appendChild(editBtn);
      tdActions.appendChild(delBtn);
      row.appendChild(tdActions);

      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    this._panel.list.appendChild(table);
  },

  _showForm(existingEntry) {
    // Remove existing form
    const existing = this._panel.list.querySelector('.cred-form');
    if (existing) existing.remove();

    const form = document.createElement('div');
    form.className = 'cred-form';

    // Scope toggle
    const scopeRow = document.createElement('div');
    scopeRow.className = 'cred-form-row cred-scope-row';
    const scopeLabel = document.createElement('label');
    scopeLabel.className = 'cred-form-label';
    scopeLabel.textContent = 'Scope';
    const scopeToggle = document.createElement('div');
    scopeToggle.className = 'cred-scope-toggle';

    let selectedScope = (existingEntry && existingEntry._scope) || (existingEntry && existingEntry.scope) || 'tab';

    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = 'cred-scope-opt' + (selectedScope === 'tab' ? ' active' : '');
    tabBtn.textContent = 'Tab';
    tabBtn.title = 'Only visible in this tab';

    const globalBtn = document.createElement('button');
    globalBtn.type = 'button';
    globalBtn.className = 'cred-scope-opt' + (selectedScope === 'global' ? ' active' : '');
    globalBtn.textContent = 'Global';
    globalBtn.title = 'Visible across all tabs';

    tabBtn.addEventListener('click', () => {
      selectedScope = 'tab';
      tabBtn.classList.add('active');
      globalBtn.classList.remove('active');
    });
    globalBtn.addEventListener('click', () => {
      selectedScope = 'global';
      globalBtn.classList.add('active');
      tabBtn.classList.remove('active');
    });

    scopeToggle.appendChild(tabBtn);
    scopeToggle.appendChild(globalBtn);
    scopeRow.appendChild(scopeLabel);
    scopeRow.appendChild(scopeToggle);
    form.appendChild(scopeRow);

    const fields = [
      { key: 'service', label: 'Service', placeholder: 'e.g., SSH, HTTP, MySQL' },
      { key: 'username', label: 'Username', placeholder: 'admin' },
      { key: 'password', label: 'Password', placeholder: 'password123', type: 'password' },
      { key: 'hash', label: 'Hash', placeholder: 'e.g., NTLM, bcrypt hash' },
      { key: 'notes', label: 'Notes', placeholder: 'Additional context' }
    ];

    const inputs = {};
    for (const field of fields) {
      const row = document.createElement('div');
      row.className = 'cred-form-row';
      const labelEl = document.createElement('label');
      labelEl.className = 'cred-form-label';
      labelEl.textContent = field.label;
      const input = document.createElement('input');
      input.className = 'cred-form-input';
      input.type = field.type || 'text';
      input.placeholder = field.placeholder;
      input.spellcheck = false;
      if (existingEntry && existingEntry[field.key]) {
        input.value = existingEntry[field.key];
      }
      inputs[field.key] = input;
      row.appendChild(labelEl);
      row.appendChild(input);

      // Show/hide toggle for password field
      if (field.type === 'password') {
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'cred-form-toggle-vis';
        toggleBtn.textContent = '\u25C9';
        toggleBtn.title = 'Show password';
        toggleBtn.addEventListener('click', () => {
          const showing = input.type === 'text';
          input.type = showing ? 'password' : 'text';
          toggleBtn.textContent = showing ? '\u25C9' : '\u25CE';
          toggleBtn.title = showing ? 'Show password' : 'Hide password';
        });
        row.appendChild(toggleBtn);
      }

      form.appendChild(row);
    }

    const actions = document.createElement('div');
    actions.className = 'cred-form-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'cred-form-save';
    saveBtn.textContent = existingEntry ? 'Update' : 'Add';
    saveBtn.addEventListener('click', async () => {
      const data = {};
      let hasValue = false;
      for (const field of fields) {
        const val = inputs[field.key].value.trim();
        if (val) { data[field.key] = val; hasValue = true; }
      }
      if (!hasValue) {
        Riptide.toast('At least one field is required');
        return;
      }
      form.remove();
      if (existingEntry) {
        const oldScope = existingEntry._scope || existingEntry.scope || 'tab';
        if (oldScope !== selectedScope) {
          // Scope changed — delete from old, create in new (with rollback)
          try {
            await this.deleteCredential(existingEntry.id, oldScope);
            try {
              await this.addCredential(data, selectedScope);
            } catch (_err) {
              // Rollback: re-create in old scope
              await this.addCredential(data, oldScope).catch(() => {});
              Riptide.toast('Scope change failed, credential restored');
              return;
            }
          } catch (_err) {
            Riptide.toast('Failed to change scope');
            return;
          }
        } else {
          await this.updateCredential(existingEntry.id, data, selectedScope);
        }
      } else {
        await this.addCredential(data, selectedScope);
      }
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cred-form-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => form.remove());

    // Enter to save, Escape to cancel
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    this._panel.list.prepend(form);
    inputs.service.focus();
  },

  async _exportCredentials() {
    const allEntries = [...this.globalEntries, ...this.entries];
    if (allEntries.length === 0) {
      Riptide.toast('No credentials to export');
      return;
    }

    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;

    // If room has a workDir, export server-side to disk
    if (Riptide.Auth.workDir) {
      try {
        const results = [];

        // Export tab credentials if any
        if (this.entries.length > 0 && tabId) {
          const result = await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/credentials/export`, {
            method: 'POST'
          });
          if (result && result.files) results.push(...result.files);
        }

        // Export global credentials if any
        if (this.globalEntries.length > 0) {
          const result = await Riptide.api('/api/credentials/export', {
            method: 'POST'
          });
          if (result && result.files) results.push(...result.files);
        }

        if (results.length > 0) {
          Riptide.toast(`Exported ${results.length} file(s)`);
          return;
        }
      } catch {
        Riptide.toast('Server export failed, downloading instead');
      }
    }

    // Fallback: browser download
    const activeTab = Riptide.Tabs.tabs.find(t => t.id === Riptide.Tabs.activeTabId);
    const prefix = (activeTab ? activeTab.name : 'export').replace(/[^a-zA-Z0-9._-]/g, '_');

    const files = [];

    const userCreds = [];
    for (const e of allEntries) {
      if (e.username && e.password) userCreds.push(`${e.username}:${e.password}`);
      if (e.username && e.hash) userCreds.push(`${e.username}:${e.hash}`);
    }
    if (userCreds.length) files.push({ name: `${prefix}_credentials.txt`, content: userCreds.join('\n') });

    const usernames = [...new Set(
      allEntries.filter(e => e.username).map(e => e.username)
    )].join('\n');
    if (usernames) files.push({ name: `${prefix}_usernames.txt`, content: usernames });

    const secrets = [...new Set([
      ...allEntries.filter(e => e.password).map(e => e.password),
      ...allEntries.filter(e => e.hash).map(e => e.hash)
    ])].join('\n');
    if (secrets) files.push({ name: `${prefix}_passwords_hashes.txt`, content: secrets });

    if (files.length === 0) {
      Riptide.toast('No exportable data found');
      return;
    }

    for (const file of files) {
      const blob = new Blob([file.content + '\n'], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    Riptide.toast(`Exported ${files.length} file(s)`);
  },

  _handleSecretClick(el, value, label) {
    const isMasked = el.classList.contains('masked');
    if (isMasked) {
      // First click: reveal
      el.classList.remove('masked');
      el.title = 'Click to copy';
    } else {
      // Second click: copy and re-blur
      this._copyToClipboard(value, label);
      el.classList.add('masked');
      el.title = 'Click to reveal';
    }
  },

  _copyToClipboard(text, label) {
    Riptide.clipboard(text, label);
  }
};
