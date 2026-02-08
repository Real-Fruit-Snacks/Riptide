window.Riptide = window.Riptide || {};

Riptide.Playbooks = {
  sections: new Map(),
  searchTerm: '',
  _searchTimeout: null,
  _dropdownIndex: -1,
  _activeTag: null,
  _cachedTags: null,

  init() {
    const searchInput = document.getElementById('playbook-search');

    searchInput.addEventListener('input', (e) => {
      this.searchTerm = e.target.value.trim();
      clearTimeout(this._searchTimeout);

      if (!this.searchTerm && !this._activeTag) {
        this._hideDropdown();
        return;
      }

      this._searchTimeout = setTimeout(() => {
        this._performSearch(this.searchTerm);
      }, 300);
    });

    searchInput.addEventListener('focus', () => {
      if (!this.searchTerm && !this._activeTag) {
        this._showTagsDropdown();
      }
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this._hideDropdown();
        searchInput.value = '';
        this.searchTerm = '';
        searchInput.blur();
        return;
      }

      const dropdown = document.getElementById('library-dropdown');
      if (!dropdown || dropdown.classList.contains('hidden')) return;

      const items = dropdown.querySelectorAll('.ld-item');
      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._dropdownIndex = Math.min(this._dropdownIndex + 1, items.length - 1);
        this._highlightDropdownItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._dropdownIndex = Math.max(this._dropdownIndex - 1, 0);
        this._highlightDropdownItem(items);
      } else if (e.key === 'Enter' && this._dropdownIndex >= 0) {
        e.preventDefault();
        items[this._dropdownIndex].click();
      }
    });

    document.addEventListener('click', (e) => {
      const toolbar = document.getElementById('playbook-toolbar');
      if (!toolbar.contains(e.target)) {
        this._hideDropdown();
      }
    });

    document.getElementById('btn-add-playbook').addEventListener('click', () => {
      this.addPlaybook();
    });

    document.getElementById('btn-browse-library').addEventListener('click', () => {
      if (Riptide.LibraryBrowser) Riptide.LibraryBrowser.open();
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        for (const section of this.sections.values()) {
          if (section.mode === 'edit') {
            this._saveNow(section.noteId);
          }
        }
      }
    });
  },

  async loadStack(previousTabId) {
    await this.clearStack(previousTabId);
    const tabId = this._getTabId();
    if (!tabId) return;

    try {
      const notes = await Riptide.Notes.list(tabId);
      const tab = Riptide.Tabs.getActiveTab();
      const activeNoteId = tab ? tab.activeNoteId : null;

      const stack = document.getElementById('playbook-stack');

      for (const note of notes) {
        const sectionEl = this._buildSection(note.id, note.title);
        stack.appendChild(sectionEl);

        this.sections.set(note.id, {
          noteId: note.id,
          title: note.title,
          content: null,
          mode: 'view',
          expanded: false,
          saveTimeout: null,
          severity: note.severity || null,
          el: sectionEl
        });
        this._updateSeverityBadge(note.id);
      }

      const expandId = activeNoteId && this.sections.has(activeNoteId)
        ? activeNoteId
        : (notes.length > 0 ? notes[0].id : null);

      if (expandId) {
        await this._expandSection(expandId);
      }
    } catch (err) {
      console.error('Failed to load playbook stack:', err);
    }
  },

  async clearStack(previousTabId) {
    await this._saveAllDirty();
    const tabId = previousTabId || this._getTabId();
    for (const section of this.sections.values()) {
      if (section.saveTimeout) {
        clearTimeout(section.saveTimeout);
      }
      if (section.mode === 'edit' && tabId) {
        Riptide.Sync.sendNoteEditDone(tabId, section.noteId);
      }
      if (section.cmEditor) {
        Riptide.Editor.destroy(section.cmEditor);
        section.cmEditor = null;
      }
      if (section.popupEl) {
        section.popupEl.remove();
      }
    }
    this.sections.clear();
    document.getElementById('playbook-stack').innerHTML = '';
    document.getElementById('playbook-search').value = '';
    this.searchTerm = '';
    clearTimeout(this._searchTimeout);
    this._hideDropdown();
    Riptide.Variables.refresh();
  },

  async addPlaybook() {
    const tabId = this._getTabId();
    const title = await Riptide.Modal.prompt('New playbook title');
    if (!title) return;

    try {
      const note = await Riptide.Notes.create(tabId, title);
      const sectionEl = this._buildSection(note.id, note.title);
      document.getElementById('playbook-stack').appendChild(sectionEl);

      this.sections.set(note.id, {
        noteId: note.id,
        title: note.title,
        content: note.content,
        mode: 'view',
        expanded: false,
        saveTimeout: null,
        severity: null,
        el: sectionEl
      });

      await this._expandSection(note.id);
      this._enterEditMode(note.id);
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      await Riptide.Modal.alert('Error', err.message);
    }
  },

  async deletePlaybook(noteId) {
    const section = this.sections.get(noteId);
    if (!section) return;

    const confirmed = await Riptide.Modal.confirm(
      'Delete playbook',
      `Delete "${section.title}"?`
    );
    if (!confirmed) return;

    try {
      const tabId = this._getTabId();
      await Riptide.Notes.remove(tabId, noteId);

      clearTimeout(section.saveTimeout);
      section.el.remove();
      this.sections.delete(noteId);
      if (Riptide.Shortcuts && Riptide.Shortcuts._focusedSectionId === noteId) {
        Riptide.Shortcuts._focusedSectionId = null;
      }
    } catch (err) {
      await Riptide.Modal.alert('Error', err.message);
    }
  },

  _buildSection(noteId, title) {
    const section = document.createElement('div');
    section.className = 'pb-section';
    section.dataset.noteId = noteId;

    const header = document.createElement('div');
    header.className = 'pb-header';

    const chevron = document.createElement('span');
    chevron.className = 'pb-chevron';
    chevron.innerHTML = '&#9654;';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'pb-title';
    titleSpan.textContent = title;

    const saveStatus = document.createElement('span');
    saveStatus.className = 'pb-save-status';

    const runAllBtn = document.createElement('button');
    runAllBtn.className = 'pb-btn-run-all';
    runAllBtn.title = 'Run all commands';
    runAllBtn.innerHTML = '&#9654;&#9654;';

    const exportBtn = document.createElement('button');
    exportBtn.className = 'pb-btn-export';
    exportBtn.title = 'Export as .md';
    exportBtn.innerHTML = '&#8615;';

    const flagBtn = document.createElement('button');
    flagBtn.className = 'pb-btn-flag';
    flagBtn.title = 'Flag this finding for teammates';
    flagBtn.innerHTML = '&#9873;';

    const editBtn = document.createElement('button');
    editBtn.className = 'pb-btn-edit';
    editBtn.title = 'Edit';
    editBtn.innerHTML = '&#9998;';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'pb-btn-delete';
    deleteBtn.title = 'Delete';
    deleteBtn.innerHTML = '&times;';

    const severityBadge = document.createElement('span');
    severityBadge.className = 'pb-severity';
    severityBadge.title = 'Click to set severity';
    severityBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      this._cycleSeverity(noteId);
    });

    header.appendChild(chevron);
    header.appendChild(titleSpan);
    header.appendChild(severityBadge);
    header.appendChild(saveStatus);
    header.appendChild(runAllBtn);
    header.appendChild(exportBtn);
    header.appendChild(flagBtn);
    header.appendChild(editBtn);
    header.appendChild(deleteBtn);

    const body = document.createElement('div');
    body.className = 'pb-body hidden';

    const content = document.createElement('div');
    content.className = 'pb-content';
    body.appendChild(content);

    section.appendChild(header);
    section.appendChild(body);

    header.addEventListener('click', (e) => {
      if (e.target.closest('.pb-btn-edit') || e.target.closest('.pb-btn-delete') || e.target.closest('.pb-btn-run-all') || e.target.closest('.pb-btn-export') || e.target.closest('.pb-btn-flag') || e.target.closest('.pb-severity')) return;
      this._toggleSection(noteId);
    });

    runAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._runAll(noteId, runAllBtn);
    });

    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._exportPlaybook(noteId);
    });

    flagBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._flagFinding(noteId);
    });

    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sec = this.sections.get(noteId);
      if (sec.lockedBy) {
        Riptide.Modal.alert('Locked', `This playbook is being edited by ${sec.lockedBy}.`);
        return;
      }
      if (sec.mode === 'edit') {
        this._exitEditMode(noteId);
      } else {
        if (!sec.expanded) {
          this._expandSection(noteId).then(() => this._enterEditMode(noteId));
        } else {
          this._enterEditMode(noteId);
        }
      }
    });

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deletePlaybook(noteId);
    });

    this._initDragDrop(section, noteId);

    return section;
  },

  async _expandSection(noteId) {
    const section = this.sections.get(noteId);
    if (!section || section.expanded) return;

    if (section.content === null) {
      try {
        const note = await Riptide.Notes.load(this._getTabId(), noteId);
        section.content = note.content;
      } catch (err) {
        console.error('Failed to load note content:', err);
        return;
      }
    }

    const contentDiv = section.el.querySelector('.pb-content');
    Riptide.Preview.render(contentDiv, section.content);

    section.el.querySelector('.pb-body').classList.remove('hidden');
    section.el.querySelector('.pb-chevron').innerHTML = '&#9660;';
    section.el.classList.add('expanded');
    section.expanded = true;

    await Riptide.Tabs.setActiveNote(this._getTabId(), noteId);
    Riptide.Variables.refresh();
  },

  _collapseSection(noteId) {
    const section = this.sections.get(noteId);
    if (!section || !section.expanded) return;

    if (section.mode === 'edit') {
      this._exitEditMode(noteId);
    }

    section.el.querySelector('.pb-body').classList.add('hidden');
    section.el.querySelector('.pb-chevron').innerHTML = '&#9654;';
    section.el.classList.remove('expanded');
    section.expanded = false;
    Riptide.Variables.refresh();
  },

  _toggleSection(noteId) {
    const section = this.sections.get(noteId);
    if (!section) return;
    if (section.expanded) {
      this._collapseSection(noteId);
    } else {
      this._expandSection(noteId);
    }
  },

  async _enterEditMode(noteId) {
    const section = this.sections.get(noteId);
    if (!section || section.mode === 'edit') return;

    // Close any other open editor popup first
    for (const [otherId, otherSec] of this.sections) {
      if (otherSec.mode === 'edit' && otherId !== noteId) {
        await this._exitEditMode(otherId);
      }
    }

    section.mode = 'edit';

    // Notify others we're editing
    const tabId = this._getTabId();
    Riptide.Sync.sendNoteEditing(tabId, noteId);

    const editBtn = section.el.querySelector('.pb-btn-edit');
    editBtn.innerHTML = '&#10003;';
    editBtn.title = 'Done editing';

    // Build popup overlay
    const overlay = document.createElement('div');
    overlay.className = 'pb-editor-overlay';

    const popup = document.createElement('div');
    popup.className = 'pb-editor-popup';

    // Header
    const header = document.createElement('div');
    header.className = 'pb-editor-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'pb-editor-title';
    titleEl.textContent = section.title;

    const statusEl = document.createElement('span');
    statusEl.className = 'pb-editor-status';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pb-editor-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close editor (Esc)';

    header.appendChild(titleEl);
    header.appendChild(statusEl);
    header.appendChild(closeBtn);

    // Body — split panes
    const body = document.createElement('div');
    body.className = 'pb-editor-body';

    // Edit pane
    const editPane = document.createElement('div');
    editPane.className = 'pb-editor-pane pb-editor-edit-pane';

    const editLabel = document.createElement('div');
    editLabel.className = 'pb-editor-pane-label';
    editLabel.textContent = 'Markdown';

    const editorContainer = document.createElement('div');
    editorContainer.className = 'pb-editor-cm-container';

    editPane.appendChild(editLabel);
    editPane.appendChild(editorContainer);

    // Preview pane
    const previewPane = document.createElement('div');
    previewPane.className = 'pb-editor-pane pb-editor-preview-pane';

    const previewLabel = document.createElement('div');
    previewLabel.className = 'pb-editor-pane-label';
    previewLabel.textContent = 'Preview';

    const previewContent = document.createElement('div');
    previewContent.className = 'pb-content';
    Riptide.Preview.render(previewContent, section.content);

    previewPane.appendChild(previewLabel);
    previewPane.appendChild(previewContent);

    body.appendChild(editPane);
    body.appendChild(previewPane);

    popup.appendChild(header);
    popup.appendChild(body);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Store references for cleanup
    section.popupEl = overlay;
    section.popupStatusEl = statusEl;

    // Create CodeMirror editor
    const editor = Riptide.Editor.create(editorContainer, section.content || '', (newContent) => {
      section.content = newContent;
      this._updateSectionSaveStatus(noteId, 'Unsaved');
      this._scheduleSave(noteId);
      clearTimeout(section._previewDebounce);
      section._previewDebounce = setTimeout(() => {
        Riptide.Preview.render(previewContent, newContent);
      }, 150);
    }, {
      onImagePaste: async (blob, filename) => {
        const tabId = this._getTabId();
        if (!tabId) throw new Error('No active tab');

        const formData = new FormData();
        formData.append('files', blob, filename);

        const data = await Riptide.api('/api/tabs/' + tabId + '/files', {
          method: 'POST',
          body: formData
        });
        const uploadedName = data.files[0].name;

        // Refresh files panel
        if (Riptide.Files) Riptide.Files.load(tabId);

        Riptide.toast('Screenshot uploaded');
        return uploadedName;
      }
    });

    // Store editor instance for cleanup
    section.cmEditor = editor;

    // Listen for custom events from CodeMirror
    editorContainer.addEventListener('cm-save', () => {
      this._saveNow(noteId);
    });

    editorContainer.addEventListener('cm-escape', () => {
      this._exitEditMode(noteId);
    });

    closeBtn.addEventListener('click', () => {
      this._exitEditMode(noteId);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this._exitEditMode(noteId);
      }
    });

    Riptide.Editor.focus(editor);
  },

  async _exitEditMode(noteId) {
    const section = this.sections.get(noteId);
    if (!section || section.mode !== 'edit') return;

    const saved = await this._saveNow(noteId);
    if (!saved) {
      // Save failed — ask user whether to discard or keep editing
      const discard = await Riptide.Modal.confirm(
        'Save Failed',
        'Your changes could not be saved. Discard unsaved changes?',
        'Discard'
      );
      if (!discard) return; // Stay in edit mode
    }

    // Clean up conflict state
    if (section._hasConflict) {
      delete section._remoteContent;
      delete section._hasConflict;
    }

    section.mode = 'view';

    // Release edit lock
    const tabId = this._getTabId();
    Riptide.Sync.sendNoteEditDone(tabId, noteId);

    // Destroy CodeMirror editor
    if (section.cmEditor) {
      Riptide.Editor.destroy(section.cmEditor);
      section.cmEditor = null;
    }

    // Close editor popup
    if (section.popupEl) {
      section.popupEl.remove();
      section.popupEl = null;
      section.popupStatusEl = null;
    }

    // Re-render inline content with updated markdown
    const contentDiv = section.el.querySelector('.pb-content');
    Riptide.Preview.render(contentDiv, section.content);

    const editBtn = section.el.querySelector('.pb-btn-edit');
    editBtn.innerHTML = '&#9998;';
    editBtn.title = 'Edit';

    this._updateSectionSaveStatus(noteId, '');
    Riptide.Variables.refresh();
  },

  _scheduleSave(noteId) {
    const section = this.sections.get(noteId);
    if (!section) return;
    clearTimeout(section.saveTimeout);
    section.saveTimeout = setTimeout(() => this._saveNow(noteId), 800);
  },

  async _saveNow(noteId) {
    const section = this.sections.get(noteId);
    if (!section) return false;
    if (section._saving) return section._saving;
    clearTimeout(section.saveTimeout);
    section.saveTimeout = null;

    const tabId = this._getTabId();
    if (!tabId || section.content === null) return false;

    section._saving = (async () => {
      try {
        await Riptide.Notes.save(tabId, noteId, section.content);
        this._updateSectionSaveStatus(noteId, 'Saved');
        setTimeout(() => {
          if (this.sections.has(noteId)) {
            const current = this.sections.get(noteId);
            const statusEl = current.el.querySelector('.pb-save-status');
            if (statusEl && statusEl.textContent === 'Saved') {
              statusEl.textContent = '';
            }
          }
        }, 2000);
        return true;
      } catch (err) {
        this._updateSectionSaveStatus(noteId, 'Save failed');
        console.error('Save error:', err);
        return false;
      }
    })().finally(() => { section._saving = null; });
    return section._saving;
  },

  async _saveAllDirty() {
    const promises = [];
    for (const [noteId, section] of this.sections) {
      if (section.mode === 'edit' && section.content !== null) {
        promises.push(this._saveNow(noteId));
      }
    }
    await Promise.all(promises);
  },

  async _performSearch(query) {
    try {
      const results = await Riptide.Library.search(query, this._activeTag);
      const tags = this._cachedTags || await this._loadTags();
      this._renderDropdown(results, tags);
    } catch (err) {
      console.error('Library search failed:', err);
      this._renderDropdown([], []);
    }
  },

  async _loadTags() {
    try {
      this._cachedTags = await Riptide.Library.tags();
    } catch {
      this._cachedTags = [];
    }
    return this._cachedTags;
  },

  async _showTagsDropdown() {
    try {
      const tags = await this._loadTags();
      const results = await Riptide.Library.search('', this._activeTag);
      this._renderDropdown(results, tags);
    } catch {
      // ignore
    }
  },

  _renderDropdown(results, tags) {
    const dropdown = document.getElementById('library-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';

    // Tag chip bar
    if (tags && tags.length > 0) {
      const tagBar = document.createElement('div');
      tagBar.className = 'ld-tags-bar';

      for (const tag of tags) {
        const chip = document.createElement('span');
        chip.className = 'ld-tag-chip' + (this._activeTag === tag ? ' active' : '');
        chip.textContent = tag;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this._activeTag === tag) {
            this._activeTag = null;
          } else {
            this._activeTag = tag;
          }
          this._performSearch(this.searchTerm);
        });
        tagBar.appendChild(chip);
      }

      dropdown.appendChild(tagBar);
    }

    if (results.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'ld-empty';
      emptyEl.textContent = 'No playbooks found in library';
      dropdown.appendChild(emptyEl);
    } else {
      for (const item of results) {
        const row = document.createElement('div');
        row.className = 'ld-item';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'ld-item-title';
        titleSpan.textContent = item.title;

        const descSpan = document.createElement('span');
        descSpan.className = 'ld-item-desc';
        descSpan.textContent = item.description || '';

        row.appendChild(titleSpan);
        row.appendChild(descSpan);

        // Tag pills
        if (item.tags && item.tags.length > 0) {
          const tagsDiv = document.createElement('div');
          tagsDiv.className = 'ld-item-tags';
          for (const t of item.tags) {
            const pill = document.createElement('span');
            pill.className = 'ld-item-tag';
            pill.textContent = t;
            tagsDiv.appendChild(pill);
          }
          row.appendChild(tagsDiv);
        }

        row.addEventListener('click', () => {
          this._addFromLibrary(item.id);
        });

        dropdown.appendChild(row);
      }
    }

    // "Browse full library..." footer link
    const browseLink = document.createElement('div');
    browseLink.className = 'ld-browse-all';
    browseLink.textContent = 'Browse full library\u2026';
    browseLink.addEventListener('click', () => {
      this._hideDropdown();
      if (Riptide.LibraryBrowser) {
        Riptide.LibraryBrowser.open(this.searchTerm);
      }
    });
    dropdown.appendChild(browseLink);

    this._dropdownIndex = -1;
    dropdown.classList.remove('hidden');
  },

  _highlightDropdownItem(items) {
    items.forEach((el, i) => {
      el.classList.toggle('active', i === this._dropdownIndex);
    });
    if (this._dropdownIndex >= 0 && items[this._dropdownIndex]) {
      items[this._dropdownIndex].scrollIntoView({ block: 'nearest' });
    }
  },

  _hideDropdown() {
    const dropdown = document.getElementById('library-dropdown');
    if (dropdown) {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
    }
    this._dropdownIndex = -1;
    this._activeTag = null;
  },

  async _addFromLibrary(playbookId) {
    const tabId = this._getTabId();
    if (!tabId) return;

    try {
      const playbook = await Riptide.Library.get(playbookId);
      const note = await Riptide.Notes.create(tabId, playbook.title, playbook.content);

      const sectionEl = this._buildSection(note.id, note.title);
      document.getElementById('playbook-stack').appendChild(sectionEl);

      this.sections.set(note.id, {
        noteId: note.id,
        title: note.title,
        content: note.content,
        mode: 'view',
        expanded: false,
        saveTimeout: null,
        severity: null,
        el: sectionEl
      });

      await this._expandSection(note.id);
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      await Riptide.Modal.alert('Error', err.message);
    }

    this._hideDropdown();
    document.getElementById('playbook-search').value = '';
    this.searchTerm = '';
  },

  _updateSectionSaveStatus(noteId, text) {
    const section = this.sections.get(noteId);
    if (!section) return;
    const statusEl = section.el.querySelector('.pb-save-status');
    if (statusEl) statusEl.textContent = text;
    // Also update popup status if editor is open
    if (section.popupStatusEl) {
      section.popupStatusEl.textContent = text;
      section.popupStatusEl.className = 'pb-editor-status' + (text === 'Unsaved' ? ' unsaved' : '');
    }
  },

  _initDragDrop(sectionEl, noteId) {
    const header = sectionEl.querySelector('.pb-header');
    const handle = document.createElement('span');
    handle.className = 'pb-drag-handle';
    handle.innerHTML = '&#8942;&#8942;';
    handle.title = 'Drag to reorder';
    header.prepend(handle);

    sectionEl.draggable = true;

    sectionEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', noteId);
      e.dataTransfer.effectAllowed = 'move';
      sectionEl.classList.add('pb-dragging');
      requestAnimationFrame(() => {
        sectionEl.style.opacity = '0.4';
      });
    });

    sectionEl.addEventListener('dragend', () => {
      sectionEl.classList.remove('pb-dragging');
      sectionEl.style.opacity = '';
      document.querySelectorAll('.pb-drag-over-top, .pb-drag-over-bottom').forEach(el => {
        el.classList.remove('pb-drag-over-top', 'pb-drag-over-bottom');
      });
    });

    sectionEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = sectionEl.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      document.querySelectorAll('.pb-drag-over-top, .pb-drag-over-bottom').forEach(el => {
        el.classList.remove('pb-drag-over-top', 'pb-drag-over-bottom');
      });
      if (e.clientY < midY) {
        sectionEl.classList.add('pb-drag-over-top');
      } else {
        sectionEl.classList.add('pb-drag-over-bottom');
      }
    });

    sectionEl.addEventListener('dragleave', () => {
      sectionEl.classList.remove('pb-drag-over-top', 'pb-drag-over-bottom');
    });

    sectionEl.addEventListener('drop', (e) => {
      e.preventDefault();
      sectionEl.classList.remove('pb-drag-over-top', 'pb-drag-over-bottom');
      const draggedNoteId = e.dataTransfer.getData('text/plain');
      if (draggedNoteId === noteId) return;

      const stack = document.getElementById('playbook-stack');
      const draggedEl = stack.querySelector(`.pb-section[data-note-id="${CSS.escape(draggedNoteId)}"]`);
      if (!draggedEl) return;

      const rect = sectionEl.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        stack.insertBefore(draggedEl, sectionEl);
      } else {
        stack.insertBefore(draggedEl, sectionEl.nextSibling);
      }

      this._persistOrder();
    });
  },

  async _persistOrder() {
    const tabId = this._getTabId();
    if (!tabId) return;

    const stack = document.getElementById('playbook-stack');
    const order = [...stack.querySelectorAll('.pb-section')]
      .map(el => el.dataset.noteId)
      .filter(Boolean);

    try {
      await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/notes/order`, {
        method: 'PUT',
        body: { order }
      });
    } catch (err) {
      console.error('Failed to persist note order:', err);
    }
  },

  _showEditLock(noteId, nickname) {
    const section = this.sections.get(noteId);
    if (!section) return;
    section.lockedBy = nickname;
    const editBtn = section.el.querySelector('.pb-btn-edit');
    editBtn.disabled = true;
    editBtn.title = `${nickname} is editing`;
    editBtn.classList.add('pb-btn-locked');
    let indicator = section.el.querySelector('.pb-lock-indicator');
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'pb-lock-indicator';
      const saveStatus = section.el.querySelector('.pb-save-status');
      saveStatus.after(indicator);
    }
    indicator.textContent = `${nickname} editing`;
  },

  _clearEditLock(noteId) {
    const section = this.sections.get(noteId);
    if (!section) return;
    delete section.lockedBy;
    const editBtn = section.el.querySelector('.pb-btn-edit');
    editBtn.disabled = false;
    editBtn.title = 'Edit';
    editBtn.classList.remove('pb-btn-locked');
    const indicator = section.el.querySelector('.pb-lock-indicator');
    if (indicator) indicator.remove();
  },

  async _cycleSeverity(noteId) {
    const section = this.sections.get(noteId);
    if (!section) return;
    const newSeverity = Riptide.Severity.next(section.severity || null);

    section.severity = newSeverity;
    this._updateSeverityBadge(noteId);

    const tabId = this._getTabId();
    try {
      await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/notes/${encodeURIComponent(noteId)}/severity`, {
        method: 'PATCH',
        body: { severity: newSeverity }
      });
    } catch (err) {
      console.error('Failed to update severity:', err);
    }
  },

  _updateSeverityBadge(noteId) {
    const section = this.sections.get(noteId);
    if (!section) return;
    const badge = section.el.querySelector('.pb-severity');
    if (!badge) return;

    const severity = section.severity;
    Riptide.Severity.applyBadge(badge, severity);
    if (!severity) {
      badge.textContent = 'SEV';
    }
  },

  _setSeverity(noteId, severity) {
    const section = this.sections.get(noteId);
    if (!section) return;
    section.severity = severity;
    this._updateSeverityBadge(noteId);
  },

  _handleLockDenied(noteId, lockedBy) {
    const section = this.sections.get(noteId);
    if (!section) return;
    if (section.mode === 'edit') {
      this._exitEditMode(noteId);
    }
    Riptide.Modal.alert('Locked', `"${section.title}" is being edited by ${lockedBy}.`);
  },

  _runAllDelay: 500,

  async _runAll(noteId, btn) {
    const section = this.sections.get(noteId);
    if (!section) return;

    // Expand first if collapsed
    if (!section.expanded) {
      await this._expandSection(noteId);
    }

    const contentDiv = section.el.querySelector('.pb-content');
    const commands = Riptide.Preview.getCommands(contentDiv);

    if (commands.length === 0) {
      Riptide.toast('No bash commands in this playbook');
      return;
    }

    // Pre-validate all commands for missing variables
    const allMissing = new Set();
    const substituted = [];
    for (const cmd of commands) {
      const { result, missing } = Riptide.Variables.substituteCommand(cmd.raw);
      missing.forEach(m => allMissing.add(m));
      substituted.push({ result, preEl: cmd.preEl, raw: cmd.raw });
    }

    if (allMissing.size > 0) {
      Riptide.toast('Missing: ' + [...allMissing].join(', '));
      return;
    }

    // Shift+click to configure delay
    const delayMs = this._runAllDelay;

    const originalText = btn.innerHTML;
    btn.disabled = true;
    let cancelled = false;

    const cancelHandler = (e) => {
      e.stopPropagation();
      cancelled = true;
    };
    btn.disabled = false;
    btn.addEventListener('click', cancelHandler);

    const tabId = this._getTabId();

    for (let i = 0; i < substituted.length; i++) {
      if (cancelled) break;

      const cmd = substituted[i];
      btn.textContent = `Running ${i + 1}/${substituted.length}...`;
      btn.className = 'pb-btn-run-all running';

      cmd.preEl.classList.add('pb-running-block');

      // Check if this is a confirm block
      if (cmd.preEl.classList.contains('confirm-block')) {
        const confirmed = await Riptide.Modal.confirm(
          'Confirm Execution',
          'This command requires confirmation:\n\n' + cmd.result,
          'Execute'
        );
        if (!confirmed) {
          cmd.preEl.classList.remove('pb-running-block');
          continue; // Skip this command
        }
        if (cancelled) break;
      }

      Riptide.Terminal.sendCommand(cmd.result);

      if (tabId && Riptide.History) {
        Riptide.History.log(tabId, cmd.result);
      }

      // Log to audit trail
      if (tabId && Riptide.AuditLog) {
        const auditSection = this.sections.get(noteId);
        const tabVars = Riptide.Variables.getEffective();
        Riptide.AuditLog.log(tabId, {
          playbookTitle: auditSection ? auditSection.title : '',
          noteId,
          command: cmd.result,
          variables: tabVars,
          type: 'run-all'
        });
      }

      // Wait for delay before next command
      if (i < substituted.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      cmd.preEl.classList.remove('pb-running-block');
    }

    btn.removeEventListener('click', cancelHandler);
    btn.textContent = cancelled ? 'Cancelled' : 'Done!';
    btn.className = 'pb-btn-run-all ' + (cancelled ? 'cancelled' : 'completed');

    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.className = 'pb-btn-run-all';
    }, 1500);
  },

  _showConflictIndicator(noteId, user) {
    const section = this.sections.get(noteId);
    if (!section || !section.popupStatusEl) return;

    section._hasConflict = true;
    section.popupStatusEl.textContent = `⚠ Updated by ${user || 'another user'}`;
    section.popupStatusEl.className = 'pb-editor-status conflict';
  },

  async _exportPlaybook(noteId) {
    const section = this.sections.get(noteId);
    if (!section) return;

    // Load content if not loaded
    if (section.content === null) {
      const note = await Riptide.Notes.load(this._getTabId(), noteId);
      section.content = note.content;
    }

    const blob = new Blob([section.content || ''], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (section.title || 'playbook').replace(/[^a-zA-Z0-9_-]/g, '_') + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Riptide.toast('Exported: ' + section.title);
  },

  _flagFinding(noteId) {
    const section = this.sections.get(noteId);
    if (!section) return;

    let preview = '';
    if (section.content) {
      const lines = section.content.split('\n')
        .filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('```'))
        .slice(0, 2);
      preview = lines.join(' ').substring(0, 150);
    }

    Riptide.Alerts.flag('playbook', section.title || 'Untitled', preview);
  },

  async _importPlaybooks(files) {
    const tabId = this._getTabId();
    if (!tabId) return;

    for (const file of files) {
      if (!file.name.endsWith('.md')) continue;

      const content = await file.text();
      const title = file.name.replace(/\.md$/, '').replace(/_/g, ' ');

      try {
        const note = await Riptide.Notes.create(tabId, title, content);
        const sectionEl = this._buildSection(note.id, note.title);
        document.getElementById('playbook-stack').appendChild(sectionEl);

        this.sections.set(note.id, {
          noteId: note.id,
          title: note.title,
          content: note.content,
          mode: 'view',
          expanded: false,
          saveTimeout: null,
          severity: null,
          el: sectionEl
        });
      } catch (err) {
        console.error('Failed to import ' + file.name, err);
      }
    }

    Riptide.toast(files.length + ' playbook(s) imported');
  },

  _getTabId() {
    return Riptide.Tabs.activeTabId;
  }
};
