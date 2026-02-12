window.Riptide = window.Riptide || {};

/**
 * Knowledge Base — global KB accessible from toolbar button.
 * Opens as a full-screen modal with search, filtering, and CRUD operations.
 */
Riptide.Knowledge = {
  entries: [],
  allTags: {},
  _overlay: null,
  _modal: null,
  _searchInput: null,
  _typeFilterContainer: null,
  _activeTypes: [],
  _tagContainer: null,
  _tagsToggle: null,
  _tagsVisible: false,
  _resultsContainer: null,
  _detailContainer: null,
  _searchTimeout: null,
  _activeTag: null,
  _mode: 'list', // 'list', 'detail', or 'form'
  _activeDetailPopup: null,

  init() {
    // Hook up toolbar button
    const btn = document.getElementById('btn-knowledge');
    if (btn) {
      btn.addEventListener('click', () => this.open());
    }
    this._buildModal();
  },

  async open() {
    this._overlay.classList.remove('hidden');
    this._mode = 'list';
    this._detailContainer.classList.add('hidden');
    this._resultsContainer.classList.remove('hidden');
    await this.load();
    this._searchInput.focus();
  },

  close() {
    this._closeDetailPopup();
    this._overlay.classList.add('hidden');
    this._searchInput.value = '';
    this._activeTypes = [];
    if (this._typeFilterContainer) {
      this._typeFilterContainer.querySelectorAll('.rs-kb-type-chip.active').forEach(c => c.classList.remove('active'));
    }
    this._activeTag = null;
    if (this._tagContainer) {
      this._tagContainer.querySelectorAll('.kb-tag-chip.active').forEach(c => c.classList.remove('active'));
    }
  },

  async load() {
    try {
      const data = await Riptide.api('/api/knowledge');
      this.entries = data.entries || [];
    } catch {
      this.entries = [];
    }
    await this._loadTags();
    this._renderResults();
  },

  async _loadTags() {
    try {
      const data = await Riptide.api('/api/knowledge/tags');
      this.allTags = data.tags || {};
    } catch {
      this.allTags = {};
    }
    this._renderTagChips();
  },

  async search(query, tag) {
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (tag) params.set('tag', tag);
      const data = await Riptide.api(`/api/knowledge?${params}`);
      this.entries = data.entries || [];
      // Client-side multi-type filter
      if (this._activeTypes.length > 0) {
        this.entries = this.entries.filter(e => this._activeTypes.includes(e.type));
      }
    } catch {
      this.entries = [];
    }
    this._renderResults();
  },

  _buildModal() {
    // Create overlay
    this._overlay = document.createElement('div');
    this._overlay.className = 'kb-modal-overlay hidden';
    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) this.close();
    });

    // Create modal
    this._modal = document.createElement('div');
    this._modal.className = 'kb-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'kb-modal-header';

    const title = document.createElement('h2');
    title.className = 'kb-modal-title';
    title.textContent = 'Knowledge Base';

    const headerActions = document.createElement('div');
    headerActions.className = 'kb-modal-header-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'kb-modal-add-btn';
    addBtn.textContent = '+ Add Entry';
    addBtn.addEventListener('click', () => this._showForm(null));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'kb-modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.close());

    headerActions.appendChild(addBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(headerActions);

    // Search bar
    const searchBar = document.createElement('div');
    searchBar.className = 'kb-modal-search';

    const searchRow = document.createElement('div');
    searchRow.className = 'kb-modal-search-row';

    this._searchInput = document.createElement('input');
    this._searchInput.type = 'text';
    this._searchInput.className = 'kb-modal-search-input';
    this._searchInput.placeholder = 'Search techniques, tools, services...';
    this._searchInput.addEventListener('input', () => {
      clearTimeout(this._searchTimeout);
      this._searchTimeout = setTimeout(() => this._performSearch(), 300);
    });
    this._searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });

    searchRow.appendChild(this._searchInput);

    // Type filter chips
    this._typeFilterContainer = document.createElement('div');
    this._typeFilterContainer.className = 'kb-modal-type-chips';
    const types = ['technique', 'service', 'tool', 'credential-pattern', 'finding', 'note'];
    types.forEach(t => {
      const chip = document.createElement('button');
      chip.className = 'rs-kb-type-chip';
      chip.dataset.type = t;
      chip.textContent = t.replace('-', ' ');
      chip.addEventListener('click', () => {
        const idx = this._activeTypes.indexOf(t);
        if (idx !== -1) {
          this._activeTypes.splice(idx, 1);
          chip.classList.remove('active');
        } else {
          this._activeTypes.push(t);
          chip.classList.add('active');
        }
        this._performSearch();
      });
      this._typeFilterContainer.appendChild(chip);
    });

    // Tags toggle
    this._tagsToggle = document.createElement('button');
    this._tagsToggle.className = 'kb-modal-tags-toggle';
    this._tagsToggle.textContent = 'Filter by tag';
    this._tagsToggle.addEventListener('click', () => {
      this._tagsVisible = !this._tagsVisible;
      this._tagContainer.classList.toggle('hidden', !this._tagsVisible);
      this._tagsToggle.textContent = this._tagsVisible ? 'Hide tags' : 'Filter by tag';
    });

    this._tagContainer = document.createElement('div');
    this._tagContainer.className = 'kb-modal-tags hidden';

    searchBar.appendChild(searchRow);
    searchBar.appendChild(this._typeFilterContainer);
    searchBar.appendChild(this._tagsToggle);
    searchBar.appendChild(this._tagContainer);

    // Results container
    this._resultsContainer = document.createElement('div');
    this._resultsContainer.className = 'kb-modal-results';

    // Detail container (hidden by default)
    this._detailContainer = document.createElement('div');
    this._detailContainer.className = 'kb-modal-detail hidden';

    // Assemble
    this._modal.appendChild(header);
    this._modal.appendChild(searchBar);
    this._modal.appendChild(this._resultsContainer);
    this._modal.appendChild(this._detailContainer);
    this._overlay.appendChild(this._modal);
    document.body.appendChild(this._overlay);

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this._overlay.classList.contains('hidden')) {
        if (this._activeDetailPopup) {
          this._closeDetailPopup();
        } else if (this._mode === 'form') {
          this._backToList();
        } else {
          this.close();
        }
      }
    });
  },

  _renderTagChips() {
    if (!this._tagContainer) return;
    this._tagContainer.innerHTML = '';
    const sorted = Object.entries(this.allTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
    for (const [tag, count] of sorted) {
      const chip = document.createElement('button');
      chip.className = 'kb-tag-chip';
      if (this._activeTag === tag) chip.classList.add('active');
      chip.textContent = `${tag} (${count})`;
      chip.addEventListener('click', () => {
        if (this._activeTag === tag) {
          this._activeTag = null;
          chip.classList.remove('active');
        } else {
          this._tagContainer.querySelectorAll('.kb-tag-chip.active').forEach(c => c.classList.remove('active'));
          this._activeTag = tag;
          chip.classList.add('active');
        }
        this._performSearch();
      });
      this._tagContainer.appendChild(chip);
    }
  },

  _performSearch() {
    const query = this._searchInput.value.trim();
    this.search(query, this._activeTag, null);
  },

  _renderResults() {
    this._resultsContainer.innerHTML = '';

    if (this.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'kb-modal-empty';
      empty.textContent = 'No knowledge entries found.';
      this._resultsContainer.appendChild(empty);
      return;
    }

    // Count header
    const countHeader = document.createElement('div');
    countHeader.className = 'kb-modal-count';
    countHeader.textContent = `${this.entries.length} result${this.entries.length !== 1 ? 's' : ''}`;
    this._resultsContainer.appendChild(countHeader);

    // Render cards (newest first)
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      const card = document.createElement('div');
      card.className = 'kb-modal-card';

      const cardHeader = document.createElement('div');
      cardHeader.className = 'kb-modal-card-header';

      const typeBadge = document.createElement('span');
      typeBadge.className = 'kb-type kb-type-' + (entry.type || 'note');
      typeBadge.textContent = (entry.type || 'note').toUpperCase();
      cardHeader.appendChild(typeBadge);

      const titleEl = document.createElement('span');
      titleEl.className = 'kb-modal-card-title';
      titleEl.textContent = entry.title || 'Untitled';
      cardHeader.appendChild(titleEl);

      // Action buttons
      const actions = document.createElement('div');
      actions.className = 'kb-modal-card-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'kb-action-btn';
      editBtn.innerHTML = '&#9998;';
      editBtn.title = 'Edit';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showForm(entry);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'kb-action-btn kb-del-btn';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await Riptide.Modal.confirm('Delete entry', `Delete "${entry.title || 'this entry'}"?`);
        if (confirmed) this.deleteEntry(entry.id);
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      cardHeader.appendChild(actions);

      card.appendChild(cardHeader);

      // Tags
      if (entry.tags && entry.tags.length > 0) {
        const tagsRow = document.createElement('div');
        tagsRow.className = 'kb-modal-card-tags';
        entry.tags.slice(0, 5).forEach(tag => {
          const tagEl = document.createElement('span');
          tagEl.className = 'kb-tag';
          tagEl.textContent = tag;
          tagsRow.appendChild(tagEl);
        });
        card.appendChild(tagsRow);
      }

      // Preview
      if (entry.content) {
        const preview = document.createElement('div');
        preview.className = 'kb-modal-card-preview';
        preview.textContent = entry.content.length > 150
          ? entry.content.substring(0, 150) + '...'
          : entry.content;
        card.appendChild(preview);
      }

      // Meta
      const meta = document.createElement('div');
      meta.className = 'kb-modal-card-meta';
      const parts = [];
      if (entry.sourceRoom) parts.push(entry.sourceRoom);
      if (entry.sourceTab) parts.push(entry.sourceTab);
      if (entry.timestamp) {
        parts.push(new Date(entry.timestamp).toLocaleDateString());
      }
      meta.textContent = parts.join(' · ');
      card.appendChild(meta);

      // Click to show detail
      card.addEventListener('click', () => this._showDetail(entry));

      this._resultsContainer.appendChild(card);
    }
  },

  _showDetail(entry) {
    // Close any existing detail popup first
    this._closeDetailPopup();

    // Create popup overlay on top of the KB modal (results stay visible)
    const popupOverlay = document.createElement('div');
    popupOverlay.className = 'kb-detail-popup-overlay';

    const popup = document.createElement('div');
    popup.className = 'kb-detail-popup';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'kb-detail-popup-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this._closeDetailPopup());
    popup.appendChild(closeBtn);

    // Header
    const header = document.createElement('div');
    header.className = 'kb-modal-detail-header';

    const typeBadge = document.createElement('span');
    typeBadge.className = 'kb-type kb-type-' + (entry.type || 'note');
    typeBadge.textContent = (entry.type || 'note').toUpperCase();
    header.appendChild(typeBadge);

    const titleEl = document.createElement('h2');
    titleEl.className = 'kb-modal-detail-title';
    titleEl.textContent = entry.title || 'Untitled';
    header.appendChild(titleEl);

    popup.appendChild(header);

    // Tags
    if (entry.tags && entry.tags.length > 0) {
      const tagsRow = document.createElement('div');
      tagsRow.className = 'kb-modal-detail-tags';
      entry.tags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'kb-tag';
        tagEl.textContent = tag;
        tagsRow.appendChild(tagEl);
      });
      popup.appendChild(tagsRow);
    }

    // Meta
    const meta = document.createElement('div');
    meta.className = 'kb-modal-detail-meta';
    if (entry.sourceRoom) {
      const roomLabel = document.createTextNode('Room: ');
      meta.appendChild(roomLabel);
      if (entry.sourceRoomId) {
        const roomLink = document.createElement('a');
        roomLink.className = 'kb-detail-room-link';
        roomLink.href = '/?room=' + encodeURIComponent(entry.sourceRoomId);
        roomLink.target = '_blank';
        roomLink.rel = 'noopener';
        roomLink.textContent = entry.sourceRoom;
        roomLink.title = 'Open room in new tab';
        meta.appendChild(roomLink);
      } else {
        meta.appendChild(document.createTextNode(entry.sourceRoom));
      }
    }
    if (entry.sourceTab) {
      if (entry.sourceRoom) meta.appendChild(document.createTextNode(' · '));
      meta.appendChild(document.createTextNode(`Tab: ${entry.sourceTab}`));
    }
    if (entry.timestamp) {
      if (entry.sourceRoom || entry.sourceTab) meta.appendChild(document.createTextNode(' · '));
      meta.appendChild(document.createTextNode(new Date(entry.timestamp).toLocaleString()));
    }
    if (entry.addedBy) {
      meta.appendChild(document.createTextNode(` · By: ${entry.addedBy}`));
    }
    popup.appendChild(meta);

    // Content (rendered markdown)
    if (entry.content) {
      const contentEl = document.createElement('div');
      contentEl.className = 'kb-modal-detail-content';
      const raw = typeof marked.parse === 'function' ? marked.parse(entry.content) : entry.content;
      contentEl.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(raw) : raw;

      // Add copy buttons to code blocks
      contentEl.querySelectorAll('pre').forEach(pre => {
        pre.style.position = 'relative';
        const btn = document.createElement('button');
        btn.className = 'rs-kb-code-copy';
        btn.textContent = 'Copy';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const code = pre.querySelector('code');
          const text = (code || pre).textContent;
          navigator.clipboard.writeText(text).then(() => {
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
          }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
          });
        });
        pre.appendChild(btn);
      });

      popup.appendChild(contentEl);
    }

    // References
    if (entry.references && entry.references.length > 0) {
      const refsLabel = document.createElement('div');
      refsLabel.className = 'kb-refs-label';
      refsLabel.textContent = 'References:';
      popup.appendChild(refsLabel);

      const refsList = document.createElement('div');
      refsList.className = 'kb-refs-list';
      entry.references.forEach(ref => {
        const refEl = document.createElement('a');
        refEl.className = 'kb-ref';
        refEl.href = ref;
        refEl.target = '_blank';
        refEl.rel = 'noopener noreferrer';
        refEl.textContent = ref;
        refsList.appendChild(refEl);
      });
      popup.appendChild(refsList);
    }

    // Action buttons at bottom
    const detailActions = document.createElement('div');
    detailActions.className = 'kb-modal-detail-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'kb-form-save';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      this._closeDetailPopup();
      this._showForm(entry);
    });

    const copyBtn = document.createElement('button');
    copyBtn.className = 'kb-form-cancel';
    copyBtn.textContent = 'Copy Content';
    copyBtn.addEventListener('click', async () => {
      const text = entry.content || '';
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => { copyBtn.textContent = 'Copy Content'; copyBtn.classList.remove('copied'); }, 1500);
    });

    detailActions.appendChild(copyBtn);
    detailActions.appendChild(editBtn);
    popup.appendChild(detailActions);

    // Close on backdrop click
    popupOverlay.addEventListener('click', (e) => {
      if (e.target === popupOverlay) this._closeDetailPopup();
    });

    popupOverlay.appendChild(popup);
    this._overlay.appendChild(popupOverlay);
    this._activeDetailPopup = popupOverlay;
  },

  _closeDetailPopup() {
    if (this._activeDetailPopup) {
      this._activeDetailPopup.remove();
      this._activeDetailPopup = null;
    }
  },

  _backToList() {
    this._mode = 'list';
    this._closeDetailPopup();
    this._detailContainer.classList.add('hidden');
    this._resultsContainer.classList.remove('hidden');
  },

  async _showForm(existingEntry) {
    this._mode = 'form';
    this._resultsContainer.classList.add('hidden');
    this._detailContainer.classList.remove('hidden');
    this._detailContainer.innerHTML = '';

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'kb-modal-back';
    backBtn.innerHTML = '&larr; Back to results';
    backBtn.addEventListener('click', () => this._backToList());
    this._detailContainer.appendChild(backBtn);

    const form = document.createElement('div');
    form.className = 'kb-form';

    const formTitle = document.createElement('h3');
    formTitle.className = 'kb-form-title';
    formTitle.textContent = existingEntry ? 'Edit Knowledge Entry' : 'Add Knowledge Entry';
    form.appendChild(formTitle);

    // Type dropdown
    const typeRow = this._createFormRow('Type', 'select');
    const typeSelect = typeRow.input;
    const types = ['technique', 'service', 'tool', 'credential-pattern', 'finding', 'note'];
    types.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1).replace('-', ' ');
      typeSelect.appendChild(opt);
    });
    if (existingEntry) typeSelect.value = existingEntry.type || 'note';
    form.appendChild(typeRow.row);

    // Title
    const titleRow = this._createFormRow('Title', 'text', existingEntry ? existingEntry.title : '');
    titleRow.input.required = true;
    form.appendChild(titleRow.row);

    // Content
    const contentRow = this._createFormRow('Content (Markdown)', 'textarea', existingEntry ? existingEntry.content : '');
    contentRow.input.rows = 10;
    form.appendChild(contentRow.row);

    // Tags
    const tagsRow = this._createFormRow('Tags', 'text',
      existingEntry && existingEntry.tags ? existingEntry.tags.join(', ') : '');
    tagsRow.input.placeholder = 'Comma-separated tags';
    form.appendChild(tagsRow.row);

    // References
    const refsRow = this._createFormRow('References', 'textarea',
      existingEntry && existingEntry.references ? existingEntry.references.join('\n') : '');
    refsRow.input.rows = 3;
    refsRow.input.placeholder = 'One URL per line';
    form.appendChild(refsRow.row);

    // Source Room
    const sourceRoomRow = this._createFormRow('Source Room', 'text',
      existingEntry ? existingEntry.sourceRoom : (Riptide.Auth ? Riptide.Auth.roomName : ''));
    if (Riptide.Auth && Riptide.Auth.roomName) sourceRoomRow.input.readOnly = true;
    form.appendChild(sourceRoomRow.row);

    // Source Tab
    const sourceTabRow = this._createFormRow('Source Tab', 'text',
      existingEntry ? existingEntry.sourceTab : (Riptide.Tabs && Riptide.Tabs.activeTabId
        ? (Riptide.Tabs.tabs.find(t => t.id === Riptide.Tabs.activeTabId) || {}).name || '' : ''));
    if (Riptide.Tabs && Riptide.Tabs.activeTabId) sourceTabRow.input.readOnly = true;
    form.appendChild(sourceTabRow.row);

    // Added By
    const addedByRow = this._createFormRow('Added By', 'text',
      existingEntry ? existingEntry.addedBy : (Riptide.Auth ? Riptide.Auth.nickname : ''));
    addedByRow.input.readOnly = true;
    form.appendChild(addedByRow.row);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'kb-form-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'kb-form-save';
    saveBtn.textContent = existingEntry ? 'Update' : 'Save';
    saveBtn.addEventListener('click', async () => {
      const title = titleRow.input.value.trim();
      if (!title) { Riptide.toast('Title is required'); return; }
      const data = {
        type: typeSelect.value,
        title,
        content: contentRow.input.value.trim(),
        tags: tagsRow.input.value.split(',').map(t => t.trim()).filter(Boolean),
        references: refsRow.input.value.split('\n').map(r => r.trim()).filter(Boolean),
        sourceRoom: sourceRoomRow.input.value.trim(),
        sourceRoomId: existingEntry ? existingEntry.sourceRoomId : (Riptide.Auth ? Riptide.Auth.roomId : ''),
        sourceTab: sourceTabRow.input.value.trim(),
        addedBy: addedByRow.input.value.trim()
      };
      if (existingEntry) {
        await this.updateEntry(existingEntry.id, data);
      } else {
        await this.addEntry(data);
      }
      this._backToList();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'kb-form-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this._backToList());

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    // Ctrl+Enter to save, Escape to cancel
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });

    this._detailContainer.appendChild(form);
    titleRow.input.focus();
  },

  _createFormRow(label, type, value = '') {
    const row = document.createElement('div');
    row.className = 'kb-form-row';
    const labelEl = document.createElement('label');
    labelEl.className = 'kb-form-label';
    labelEl.textContent = label;
    let input;
    if (type === 'textarea') {
      input = document.createElement('textarea');
      input.className = 'kb-form-textarea';
    } else if (type === 'select') {
      input = document.createElement('select');
      input.className = 'kb-form-select';
    } else {
      input = document.createElement('input');
      input.type = type;
      input.className = 'kb-form-input';
    }
    if (value && type !== 'select') input.value = value;
    row.appendChild(labelEl);
    row.appendChild(input);
    return { row, input };
  },

  async addEntry(data) {
    try {
      const result = await Riptide.api('/api/knowledge', { method: 'POST', body: data });
      this.entries.unshift(result.entry);
      await this._loadTags();
      this._renderResults();
      Riptide.toast('Knowledge entry added');
    } catch (err) {
      Riptide.toast('Failed to add entry: ' + err.message);
    }
  },

  async updateEntry(id, data) {
    try {
      const result = await Riptide.api(`/api/knowledge/${encodeURIComponent(id)}`, { method: 'PUT', body: data });
      const idx = this.entries.findIndex(e => e.id === id);
      if (idx !== -1) this.entries[idx] = result.entry;
      await this._loadTags();
      this._renderResults();
      Riptide.toast('Knowledge entry updated');
    } catch (err) {
      Riptide.toast('Failed to update entry: ' + err.message);
    }
  },

  async deleteEntry(id) {
    try {
      await Riptide.api(`/api/knowledge/${encodeURIComponent(id)}`, { method: 'DELETE' });
      this.entries = this.entries.filter(e => e.id !== id);
      await this._loadTags();
      this._renderResults();
      Riptide.toast('Knowledge entry deleted');
    } catch (err) {
      Riptide.toast('Failed to delete entry: ' + err.message);
    }
  },

  // Sync event handlers (called from sync.js)
  onKnowledgeCreated(entry) {
    this.entries.push(entry);
    if (!this._overlay.classList.contains('hidden') && this._mode === 'list') {
      this._renderResults();
    }
  },

  onKnowledgeUpdated(entry) {
    const idx = this.entries.findIndex(e => e.id === entry.id);
    if (idx !== -1) this.entries[idx] = entry;
    if (!this._overlay.classList.contains('hidden') && this._mode === 'list') {
      this._renderResults();
    }
  },

  onKnowledgeDeleted(entryId) {
    this.entries = this.entries.filter(e => e.id !== entryId);
    if (!this._overlay.classList.contains('hidden') && this._mode === 'list') {
      this._renderResults();
    }
  },

  // Save-from helpers (called from other panels)
  async saveFromPlaybook(noteTitle, noteContent, tabName) {
    this.open();
    // Small delay to let modal render
    setTimeout(() => {
      this._showForm({
        type: 'technique',
        title: noteTitle,
        content: noteContent,
        sourceRoom: Riptide.Auth ? Riptide.Auth.roomName : '',
        sourceRoomId: Riptide.Auth ? Riptide.Auth.roomId : '',
        sourceTab: tabName || '',
        addedBy: Riptide.Auth ? Riptide.Auth.nickname : ''
      });
    }, 100);
  },

  async saveFromCredential(credential, tabName) {
    this.open();
    setTimeout(() => {
      this._showForm({
        type: 'credential-pattern',
        title: `${credential.service || 'Unknown'} credential pattern`,
        content: `Service: ${credential.service || 'N/A'}\nUsername pattern: ${credential.username || 'N/A'}\nNotes: ${credential.notes || ''}`,
        tags: credential.service ? [credential.service.toLowerCase()] : [],
        sourceRoom: Riptide.Auth ? Riptide.Auth.roomName : '',
        sourceRoomId: Riptide.Auth ? Riptide.Auth.roomId : '',
        sourceTab: tabName || '',
        addedBy: Riptide.Auth ? Riptide.Auth.nickname : ''
      });
    }, 100);
  },

  async saveFromCommand(command, tabName) {
    const tool = command.trim().split(/\s+/)[0].replace(/^.*\//, '');
    this.open();
    setTimeout(() => {
      this._showForm({
        type: 'tool',
        title: `${tool} command`,
        content: command,
        tags: [tool.toLowerCase()],
        references: [command],
        sourceRoom: Riptide.Auth ? Riptide.Auth.roomName : '',
        sourceRoomId: Riptide.Auth ? Riptide.Auth.roomId : '',
        sourceTab: tabName || '',
        addedBy: Riptide.Auth ? Riptide.Auth.nickname : ''
      });
    }, 100);
  },

  async saveFromScratchNote(note, tabName) {
    this.open();
    setTimeout(() => {
      this._showForm({
        type: 'finding',
        title: note.text ? note.text.substring(0, 100) : 'Finding',
        content: note.text || '',
        sourceRoom: Riptide.Auth ? Riptide.Auth.roomName : '',
        sourceRoomId: Riptide.Auth ? Riptide.Auth.roomId : '',
        sourceTab: tabName || '',
        addedBy: Riptide.Auth ? Riptide.Auth.nickname : ''
      });
    }, 100);
  },

  async saveFromAlert(alert) {
    this.open();
    setTimeout(() => {
      this._showForm({
        type: 'finding',
        title: alert.title || 'Flagged Finding',
        content: alert.preview || '',
        tags: alert.context ? [alert.context] : [],
        sourceRoom: Riptide.Auth ? Riptide.Auth.roomName : '',
        sourceRoomId: Riptide.Auth ? Riptide.Auth.roomId : '',
        sourceTab: '',
        addedBy: Riptide.Auth ? Riptide.Auth.nickname : ''
      });
    }, 100);
  }
};
