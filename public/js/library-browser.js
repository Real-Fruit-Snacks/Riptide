window.Riptide = window.Riptide || {};

Riptide.LibraryBrowser = {
  _overlay: null,
  _categories: [],
  _tags: [],
  _results: [],
  _activeCategory: null,
  _activeTags: new Set(),
  _searchQuery: '',
  _selectedId: null,
  _searchTimeout: null,
  _keyHandler: null,

  open(initialQuery) {
    if (this._overlay) return;
    this._activeCategory = null;
    this._activeTags = new Set();
    this._searchQuery = initialQuery || '';
    this._selectedId = null;
    this._overlay = this._buildOverlay();
    document.body.appendChild(this._overlay);
    requestAnimationFrame(() => {
      this._overlay.classList.add('visible');
    });
    this._loadData();
  },

  _close() {
    if (!this._overlay) return;
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    clearTimeout(this._searchTimeout);
    this._overlay.classList.remove('visible');
    setTimeout(() => {
      if (this._overlay && this._overlay.parentNode) {
        this._overlay.parentNode.removeChild(this._overlay);
      }
      this._overlay = null;
    }, 200);
  },

  _buildOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'lb-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._close();
    });

    const popup = document.createElement('div');
    popup.className = 'lb-popup';

    // Header
    const header = document.createElement('div');
    header.className = 'lb-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'lb-header-title';
    titleWrap.textContent = 'Playbook Library';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'lb-search-input';
    searchInput.placeholder = 'Search playbooks\u2026';
    searchInput.spellcheck = false;
    searchInput.value = this._searchQuery;
    this._searchInput = searchInput;

    searchInput.addEventListener('input', () => {
      this._searchQuery = searchInput.value.trim();
      clearTimeout(this._searchTimeout);
      this._searchTimeout = setTimeout(() => this._search(), 300);
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'lb-close-btn';
    closeBtn.textContent = '\u2715';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this._close());

    header.appendChild(titleWrap);
    header.appendChild(searchInput);
    header.appendChild(closeBtn);

    // Body = sidebar + main
    const body = document.createElement('div');
    body.className = 'lb-body';

    const sidebar = document.createElement('div');
    sidebar.className = 'lb-sidebar';
    this._sidebarEl = sidebar;

    const main = document.createElement('div');
    main.className = 'lb-main';

    // Tag bar
    const tagBar = document.createElement('div');
    tagBar.className = 'lb-tag-bar';
    this._tagBarEl = tagBar;

    // Results area (list + preview)
    const resultsArea = document.createElement('div');
    resultsArea.className = 'lb-results-area';

    const resultsList = document.createElement('div');
    resultsList.className = 'lb-results-list';
    this._resultsListEl = resultsList;

    const preview = document.createElement('div');
    preview.className = 'lb-preview';
    this._previewEl = preview;

    resultsArea.appendChild(resultsList);
    resultsArea.appendChild(preview);

    main.appendChild(tagBar);
    main.appendChild(resultsArea);

    body.appendChild(sidebar);
    body.appendChild(main);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'lb-footer';
    this._footerEl = footer;

    popup.appendChild(header);
    popup.appendChild(body);
    popup.appendChild(footer);
    overlay.appendChild(popup);

    // Keyboard handler
    this._keyHandler = (e) => {
      if (e.key === 'Escape') {
        // Don't close if a modal dialog is open
        if (!document.getElementById('modal-overlay').classList.contains('hidden')) return;
        e.stopPropagation();
        this._close();
      }
    };
    document.addEventListener('keydown', this._keyHandler, true);

    return overlay;
  },

  async _loadData() {
    try {
      const [categories, tags, results] = await Promise.all([
        Riptide.Library.categories(),
        Riptide.Library.tags(),
        Riptide.Library.browse(this._searchQuery, [], null)
      ]);
      this._categories = categories;
      this._tags = tags;
      this._results = results;
      this._buildSidebar(categories);
      this._renderTagBar(tags);
      this._renderResults(results);
      this._updateFooter(results.length);
      // Focus search input after load
      if (this._searchInput) this._searchInput.focus();
    } catch (err) {
      console.error('Library browser load failed:', err);
    }
  },

  _buildSidebar(categories) {
    const sidebar = this._sidebarEl;
    if (!sidebar) return;
    sidebar.innerHTML = '';

    // "All" item
    const totalCount = categories.reduce((sum, c) => sum + c.count, 0);
    const allItem = document.createElement('div');
    allItem.className = 'lb-nav-item' + (this._activeCategory === null ? ' active' : '');
    allItem.innerHTML = '<span>All</span><span class="lb-nav-count">' + totalCount + '</span>';
    allItem.addEventListener('click', () => {
      this._activeCategory = null;
      this._updateSidebarActive();
      this._search();
    });
    sidebar.appendChild(allItem);

    // Category items
    for (const cat of categories) {
      const item = document.createElement('div');
      item.className = 'lb-nav-item' + (this._activeCategory === cat.name ? ' active' : '');
      item.dataset.category = cat.name;
      item.innerHTML = '<span>' + this._escHtml(cat.name) + '</span><span class="lb-nav-count">' + cat.count + '</span>';
      item.addEventListener('click', () => {
        this._activeCategory = cat.name;
        this._activeTags.clear();
        this._updateSidebarActive();
        this._updateTagBarActive();
        this._search();
      });
      sidebar.appendChild(item);
    }
  },

  _updateSidebarActive() {
    if (!this._sidebarEl) return;
    this._sidebarEl.querySelectorAll('.lb-nav-item').forEach(el => {
      const cat = el.dataset.category || null;
      el.classList.toggle('active', cat === this._activeCategory);
    });
  },

  _renderTagBar(tags) {
    const bar = this._tagBarEl;
    if (!bar) return;
    bar.innerHTML = '';

    if (!tags || tags.length === 0) return;

    for (const tag of tags) {
      const chip = document.createElement('span');
      chip.className = 'lb-tag-chip' + (this._activeTags.has(tag) ? ' active' : '');
      chip.textContent = tag;
      chip.addEventListener('click', () => {
        if (this._activeTags.has(tag)) {
          this._activeTags.delete(tag);
        } else {
          this._activeTags.add(tag);
        }
        this._updateTagBarActive();
        this._search();
      });
      bar.appendChild(chip);
    }
  },

  _updateTagBarActive() {
    if (!this._tagBarEl) return;
    this._tagBarEl.querySelectorAll('.lb-tag-chip').forEach(chip => {
      chip.classList.toggle('active', this._activeTags.has(chip.textContent));
    });
  },

  async _search() {
    try {
      const tagsArr = [...this._activeTags];
      const results = await Riptide.Library.browse(
        this._searchQuery,
        tagsArr,
        this._activeCategory
      );
      this._results = results;
      this._renderResults(results);
      this._updateFooter(results.length);
    } catch (err) {
      console.error('Library search failed:', err);
    }
  },

  _renderResults(results) {
    const list = this._resultsListEl;
    if (!list) return;
    list.innerHTML = '';

    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = 'No playbooks found';
      list.appendChild(empty);
      return;
    }

    for (const item of results) {
      const row = document.createElement('div');
      row.className = 'lb-result' + (this._selectedId === item.id ? ' active' : '');
      row.dataset.id = item.id;

      const title = document.createElement('div');
      title.className = 'lb-result-title';
      title.textContent = item.title;

      const desc = document.createElement('div');
      desc.className = 'lb-result-desc';
      desc.textContent = item.description || '';

      const meta = document.createElement('div');
      meta.className = 'lb-result-meta';

      if (item.category && item.category !== 'Uncategorized') {
        const catBadge = document.createElement('span');
        catBadge.className = 'lb-result-category';
        catBadge.textContent = item.category;
        meta.appendChild(catBadge);
      }

      if (item.tags && item.tags.length > 0) {
        for (const t of item.tags.slice(0, 4)) {
          const pill = document.createElement('span');
          pill.className = 'lb-result-tag';
          pill.textContent = t;
          meta.appendChild(pill);
        }
        if (item.tags.length > 4) {
          const more = document.createElement('span');
          more.className = 'lb-result-tag lb-result-tag-more';
          more.textContent = '+' + (item.tags.length - 4);
          meta.appendChild(more);
        }
      }

      row.appendChild(title);
      row.appendChild(desc);
      row.appendChild(meta);

      row.addEventListener('click', () => {
        this._selectResult(item.id);
      });

      list.appendChild(row);
    }
  },

  async _selectResult(id) {
    this._selectedId = id;

    // Update active state in results list
    if (this._resultsListEl) {
      this._resultsListEl.querySelectorAll('.lb-result').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
      });
      this._resultsListEl.classList.add('narrow');
    }

    // Fetch full playbook and render preview
    try {
      const playbook = await Riptide.Library.get(id);
      this._renderPreview(playbook);
    } catch (err) {
      console.error('Failed to load playbook:', err);
    }
  },

  _renderPreview(playbook) {
    const pane = this._previewEl;
    if (!pane) return;
    pane.innerHTML = '';
    pane.classList.add('visible');

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'lb-preview-back';
    backBtn.textContent = '\u2190 Back';
    backBtn.addEventListener('click', () => {
      this._selectedId = null;
      pane.classList.remove('visible');
      pane.innerHTML = '';
      if (this._resultsListEl) {
        this._resultsListEl.classList.remove('narrow');
        this._resultsListEl.querySelectorAll('.lb-result').forEach(el => {
          el.classList.remove('active');
        });
      }
    });
    pane.appendChild(backBtn);

    // Title
    const title = document.createElement('h2');
    title.className = 'lb-preview-title';
    title.textContent = playbook.title;
    pane.appendChild(title);

    // Tags
    if (playbook.tags && playbook.tags.length > 0) {
      const tagsDiv = document.createElement('div');
      tagsDiv.className = 'lb-preview-tags';
      for (const t of playbook.tags) {
        const pill = document.createElement('span');
        pill.className = 'lb-result-tag';
        pill.textContent = t;
        tagsDiv.appendChild(pill);
      }
      pane.appendChild(tagsDiv);
    }

    // Category badge
    if (playbook.category && playbook.category !== 'Uncategorized') {
      const catBadge = document.createElement('div');
      catBadge.className = 'lb-preview-category';
      catBadge.textContent = playbook.category;
      pane.appendChild(catBadge);
    }

    // Rendered markdown content
    const content = document.createElement('div');
    content.className = 'pb-content lb-preview-content';
    Riptide.Preview.render(content, playbook.content);
    pane.appendChild(content);

    // Import button
    const importBtn = document.createElement('button');
    importBtn.className = 'lb-import-btn';
    importBtn.textContent = 'Import to Current Tab';
    importBtn.addEventListener('click', () => {
      this._importPlaybook(playbook.id);
    });
    pane.appendChild(importBtn);
  },

  async _importPlaybook(id) {
    if (Riptide.Playbooks) {
      await Riptide.Playbooks._addFromLibrary(id);
    }
    this._close();
  },

  _updateFooter(count) {
    if (!this._footerEl) return;
    this._footerEl.textContent = count + ' playbook' + (count !== 1 ? 's' : '') + ' found';
  },

  _escHtml(text) {
    const el = document.createElement('span');
    el.textContent = text || '';
    return el.innerHTML;
  }
};
