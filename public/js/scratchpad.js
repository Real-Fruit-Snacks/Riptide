window.Riptide = window.Riptide || {};

Riptide.ScratchPad = {
  _panel: null,
  _addBtn: null,
  _scopeToggle: null,
  _scope: 'tab',
  entries: [],

  init() {
    this._panel = Riptide.CollapsiblePanel.create({
      sectionId: 'scratchpad-section',
      listId: 'scratchpad-list',
      headerId: 'scratchpad-header',
      chevronClass: 'scratch-chevron',
      badgeClass: 'scratch-badge',
      label: 'Notes',
      startExpanded: true
    });

    // Scope toggle pill — insert before badge
    this._scopeToggle = document.createElement('span');
    this._scopeToggle.className = 'scratch-scope-toggle';

    const tabBtn = document.createElement('button');
    tabBtn.className = 'scratch-scope-btn active';
    tabBtn.textContent = 'Tab';
    tabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._switchScope('tab');
    });

    const globalBtn = document.createElement('button');
    globalBtn.className = 'scratch-scope-btn';
    globalBtn.textContent = 'Global';
    globalBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._switchScope('global');
    });

    this._scopeToggle.appendChild(tabBtn);
    this._scopeToggle.appendChild(globalBtn);
    this._panel.header.insertBefore(this._scopeToggle, this._panel.badge);

    // Add button
    this._addBtn = document.createElement('button');
    this._addBtn.className = 'scratch-add-btn';
    this._addBtn.textContent = '+';
    this._addBtn.title = 'Add note';
    this._addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._promptNewNote();
    });
    this._panel.header.appendChild(this._addBtn);
  },

  async load(tabId) {
    try {
      const params = new URLSearchParams({ scope: this._scope });
      if (tabId) params.set('tabId', tabId);
      this.entries = await Riptide.api(`/api/scratch-notes?${params}`);
    } catch {
      this.entries = [];
    }
    this._render();
  },

  async addNote(text) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    try {
      const data = await Riptide.api('/api/scratch-notes', {
        method: 'POST',
        body: { scope: this._scope, tabId, text }
      });
      this.entries.push(data.entry);
      this._render();
    } catch {
      Riptide.toast('Failed to save note');
    }
  },

  async updateNote(id, text) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    try {
      await Riptide.api(`/api/scratch-notes/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: { scope: this._scope, tabId, text }
      });
      const idx = this.entries.findIndex(e => e.id === id);
      if (idx !== -1) {
        this.entries[idx].text = text;
      }
      this._render();
    } catch {
      Riptide.toast('Failed to update note');
    }
  },

  async deleteNote(id) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    try {
      const params = new URLSearchParams({ scope: this._scope });
      if (tabId) params.set('tabId', tabId);
      await Riptide.api(`/api/scratch-notes/${encodeURIComponent(id)}?${params}`, {
        method: 'DELETE'
      });
      this.entries = this.entries.filter(e => e.id !== id);
      this._render();
    } catch {
      Riptide.toast('Failed to delete note');
    }
  },

  // Called by sync when remote events arrive
  addEntry(entry) {
    this.entries.push(entry);
    this._render();
  },

  updateEntry(entry) {
    const idx = this.entries.findIndex(e => e.id === entry.id);
    if (idx !== -1) {
      this.entries[idx] = entry;
    } else {
      this.entries.push(entry);
    }
    this._render();
  },

  removeEntry(noteId) {
    this.entries = this.entries.filter(e => e.id !== noteId);
    this._render();
  },

  async _switchScope(newScope) {
    this._scope = newScope;
    // Update toggle UI
    const btns = this._scopeToggle.querySelectorAll('.scratch-scope-btn');
    btns.forEach(btn => {
      if (btn.textContent.toLowerCase() === newScope) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    await this.load(tabId);
  },

  _render() {
    this._panel.list.innerHTML = '';
    this._panel.badge.textContent = this.entries.length > 0 ? this.entries.length : '';

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      const row = document.createElement('div');
      row.className = 'scratch-entry';
      row.dataset.noteId = entry.id;

      // Severity badge
      const sevBadge = document.createElement('span');
      sevBadge.className = 'scratch-severity';
      this._applySeverityBadge(sevBadge, entry.severity);
      sevBadge.title = 'Click to set severity';
      sevBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        this._cycleSeverity(entry.id);
      });

      // Timestamp
      const time = document.createElement('span');
      time.className = 'scratch-time';
      const d = new Date(entry.timestamp);
      time.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // User
      const user = document.createElement('span');
      user.className = 'scratch-user';
      user.textContent = entry.user || '';

      // Text content
      const textEl = document.createElement('div');
      textEl.className = 'scratch-text';
      textEl.textContent = entry.text;

      // KB button
      const kbBtn = document.createElement('button');
      kbBtn.className = 'scratch-kb-btn';
      kbBtn.title = 'Save to Knowledge Base';
      kbBtn.textContent = 'KB';
      kbBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (Riptide.Knowledge) {
          const tabName = Riptide.Tabs && Riptide.Tabs.activeTabId
            ? (Riptide.Tabs.tabs.find(t => t.id === Riptide.Tabs.activeTabId) || {}).name || ''
            : '';
          Riptide.Knowledge.saveFromScratchNote(entry, tabName);
        }
      });

      // Flag button
      const flagBtn = document.createElement('button');
      flagBtn.className = 'scratch-flag-btn';
      flagBtn.innerHTML = '&#9873;';
      flagBtn.title = 'Flag finding to teammates';
      flagBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._flagFinding(entry);
      });

      // Edit button (pencil icon)
      const editBtn = document.createElement('button');
      editBtn.className = 'scratch-edit-btn';
      editBtn.innerHTML = '&#9998;';
      editBtn.title = 'Edit note';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._editNote(entry);
      });

      // Delete button (x)
      const delBtn = document.createElement('button');
      delBtn.className = 'scratch-del-btn';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete note';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const preview = (entry.text || '').slice(0, 30) || 'this note';
        const confirmed = await Riptide.Modal.confirm(
          'Delete note',
          `Delete "${preview}"?`
        );
        if (confirmed) this.deleteNote(entry.id);
      });

      const meta = document.createElement('div');
      meta.className = 'scratch-meta';
      meta.appendChild(sevBadge);
      meta.appendChild(time);
      meta.appendChild(user);
      meta.appendChild(kbBtn);
      meta.appendChild(flagBtn);
      meta.appendChild(editBtn);
      meta.appendChild(delBtn);

      row.appendChild(meta);
      row.appendChild(textEl);

      this._panel.list.appendChild(row);
    }
  },

  _promptNewNote() {
    this._showInlineEditor(null);
  },

  _showInlineEditor(existingEntry) {
    // Remove any existing inline editor first
    const existing = this._panel.list.querySelector('.scratch-inline-editor');
    if (existing) existing.remove();

    const editor = document.createElement('div');
    editor.className = 'scratch-inline-editor';

    const textarea = document.createElement('textarea');
    textarea.className = 'scratch-textarea';
    textarea.placeholder = 'Type your note...';
    textarea.rows = 3;
    if (existingEntry) textarea.value = existingEntry.text;

    const actions = document.createElement('div');
    actions.className = 'scratch-editor-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'scratch-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      const text = textarea.value.trim();
      if (!text) return;
      editor.remove();
      if (existingEntry) {
        await this.updateNote(existingEntry.id, text);
      } else {
        await this.addNote(text);
      }
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'scratch-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => editor.remove());

    // Ctrl+Enter to save, Escape to cancel
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        saveBtn.click();
      }
      if (e.key === 'Escape') {
        cancelBtn.click();
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    editor.appendChild(textarea);
    editor.appendChild(actions);

    this._panel.list.prepend(editor);
    textarea.focus();
  },

  _editNote(entry) {
    this._showInlineEditor(entry);
  },

  _applySeverityBadge(el, severity) {
    Riptide.Severity.applyBadge(el, severity);
    if (!severity) {
      el.textContent = 'SEV';
      el.style.display = '';
    }
  },

  async _cycleSeverity(noteId) {
    const entry = this.entries.find(e => e.id === noteId);
    if (!entry) return;
    const newSeverity = Riptide.Severity.next(entry.severity || null);

    entry.severity = newSeverity;

    // Update the badge in DOM without full re-render
    const row = this._panel.list.querySelector(`.scratch-entry[data-note-id="${CSS.escape(noteId)}"]`);
    if (row) {
      const badge = row.querySelector('.scratch-severity');
      if (badge) this._applySeverityBadge(badge, newSeverity);
    }

    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    try {
      await Riptide.api(`/api/scratch-notes/${encodeURIComponent(noteId)}/severity`, {
        method: 'PATCH',
        body: { scope: this._scope, tabId, severity: newSeverity }
      });
    } catch (err) {
      console.error('Failed to update scratch note severity:', err);
    }
  },

  _flagFinding(entry) {
    const preview = (entry.text || '').substring(0, 150);
    const sevLabel = entry.severity ? ` [${entry.severity.toUpperCase()}]` : '';

    Riptide.Alerts.flag('note', 'Scratch Note' + sevLabel, preview);
  },

  setSeverity(noteId, severity) {
    const entry = this.entries.find(e => e.id === noteId);
    if (!entry) return;
    entry.severity = severity;
    const row = this._panel.list.querySelector(`.scratch-entry[data-note-id="${CSS.escape(noteId)}"]`);
    if (row) {
      const badge = row.querySelector('.scratch-severity');
      if (badge) this._applySeverityBadge(badge, severity);
    }
  }
};
