window.Riptide = window.Riptide || {};

Riptide.Auth = {
  token: null,
  nickname: null,
  roomId: null,
  roomName: null,
  workDir: null,

  async init() {
    const stored = sessionStorage.getItem('cw_token');
    if (!stored) return false;

    try {
      const res = await fetch('/api/rooms/validate', {
        headers: { 'Authorization': 'Bearer ' + stored }
      });
      if (!res.ok) {
        sessionStorage.removeItem('cw_token');
        return false;
      }
      const data = await res.json();
      this.token = stored;
      this.roomId = data.room.id;
      this.roomName = data.room.name;
      this.workDir = data.room.workDir || null;
      this.nickname = data.nickname;
      return true;
    } catch {
      sessionStorage.removeItem('cw_token');
      return false;
    }
  },

  async listRooms() {
    const res = await fetch('/api/rooms');
    if (!res.ok) throw new Error('Failed to list rooms');
    return await res.json();
  },

  async createRoom(name, password, nickname, workDir) {
    const body = { name, password, nickname };
    if (workDir) body.workDir = workDir;
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create room');
    }
    const data = await res.json();
    this._storeSession(data);
    return data;
  },

  async joinRoom(roomId, password, nickname) {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, nickname })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to join room');
    }
    const data = await res.json();
    this._storeSession(data);
    return data;
  },

  async leave() {
    if (this.token && this.roomId) {
      try {
        await fetch(`/api/rooms/${encodeURIComponent(this.roomId)}/leave`, {
          method: 'POST',
          headers: this.getHeaders()
        });
      } catch {
        // ignore
      }
    }
    this.token = null;
    this.roomId = null;
    this.roomName = null;
    this.workDir = null;
    this.nickname = null;
    sessionStorage.removeItem('cw_token');
    sessionStorage.removeItem('cw_activeTabId');
  },

  async importRoom(roomId, token, file) {
    const buffer = await file.arrayBuffer();
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/import`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/octet-stream'
      },
      body: buffer
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to import engagement data');
    }
    return await res.json();
  },

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = 'Bearer ' + this.token;
    }
    return headers;
  },

  _storeSession(data) {
    this.token = data.token;
    this.roomId = data.room.id;
    this.roomName = data.room.name;
    this.workDir = data.room.workDir || null;
    this.nickname = data.nickname;
    sessionStorage.setItem('cw_token', data.token);
  },

  getArchivedRooms() {
    try {
      return JSON.parse(localStorage.getItem('cw_archived_rooms') || '[]');
    } catch { return []; }
  },

  setArchived(roomId, archived) {
    const list = this.getArchivedRooms();
    const idx = list.indexOf(roomId);
    if (archived && idx === -1) list.push(roomId);
    if (!archived && idx !== -1) list.splice(idx, 1);
    localStorage.setItem('cw_archived_rooms', JSON.stringify(list));
  },

  isArchived(roomId) {
    return this.getArchivedRooms().includes(roomId);
  },

  // === Knowledge Base Search (Login Screen) ===

  _kbSearchTimeout: null,
  _kbActiveTag: null,
  _kbActiveTypes: [],

  initKBSearch() {
    const searchInput = document.getElementById('rs-kb-search');

    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
      clearTimeout(this._kbSearchTimeout);
      this._kbSearchTimeout = setTimeout(() => {
        this._kbSearch(searchInput.value.trim());
      }, 300);
    });

    // Build type filter chips
    const typeContainer = document.getElementById('rs-kb-type-filter');
    if (typeContainer) {
      const types = ['technique', 'service', 'tool', 'credential-pattern', 'finding', 'note'];
      for (const t of types) {
        const chip = document.createElement('button');
        chip.className = 'rs-kb-type-chip';
        chip.dataset.type = t;
        chip.textContent = t.replace('-', ' ');
        chip.addEventListener('click', () => {
          const idx = this._kbActiveTypes.indexOf(t);
          if (idx !== -1) {
            this._kbActiveTypes.splice(idx, 1);
            chip.classList.remove('active');
          } else {
            this._kbActiveTypes.push(t);
            chip.classList.add('active');
          }
          this._kbSearch(searchInput.value.trim());
        });
        typeContainer.appendChild(chip);
      }
    }

    this._loadKBTags();
    this._kbSearch('');
  },

  async _loadKBTags() {
    try {
      const resp = await fetch('/api/knowledge/tags');
      if (!resp.ok) return;
      const data = await resp.json();
      const container = document.getElementById('rs-kb-tags');
      if (!container) return;
      container.innerHTML = '';

      const sorted = Object.entries(data.tags || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);

      if (sorted.length === 0) return;

      // Toggle link
      const toggle = document.createElement('button');
      toggle.className = 'rs-kb-tags-toggle';
      toggle.textContent = 'Filter by tag';
      container.appendChild(toggle);

      // Chips wrapper (hidden by default)
      const chips = document.createElement('div');
      chips.className = 'rs-kb-tags-chips hidden';
      container.appendChild(chips);

      toggle.addEventListener('click', () => {
        const visible = !chips.classList.contains('hidden');
        chips.classList.toggle('hidden');
        toggle.textContent = visible ? 'Filter by tag' : 'Hide tags';
      });

      for (const [tag, count] of sorted) {
        const chip = document.createElement('span');
        chip.className = 'rs-kb-tag';
        chip.dataset.tag = tag;
        chip.textContent = `${tag} (${count})`;
        chip.addEventListener('click', () => {
          if (this._kbActiveTag === tag) {
            this._kbActiveTag = null;
            chip.classList.remove('active');
          } else {
            chips.querySelectorAll('.rs-kb-tag.active').forEach(c => c.classList.remove('active'));
            this._kbActiveTag = tag;
            chip.classList.add('active');
          }
          const searchInput = document.getElementById('rs-kb-search');
          this._kbSearch(searchInput ? searchInput.value.trim() : '');
        });
        chips.appendChild(chip);
      }
    } catch (err) {
      console.error('Failed to load KB tags:', err);
    }
  },

  async _kbSearch(query) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (this._kbActiveTag) params.set('tag', this._kbActiveTag);

    try {
      const resp = await fetch(`/api/knowledge?${params}`);
      if (!resp.ok) throw new Error('Search failed');
      const data = await resp.json();
      let entries = data.entries || [];
      // Client-side multi-type filter
      if (this._kbActiveTypes.length > 0) {
        entries = entries.filter(e => this._kbActiveTypes.includes(e.type));
      }
      this._renderKBResults(entries);
    } catch (err) {
      console.error('KB search failed:', err);
    }
  },

  _renderKBResults(entries) {
    const container = document.getElementById('rs-kb-results');
    if (!container) return;
    container.innerHTML = '';

    if (entries.length === 0) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    const header = document.createElement('div');
    header.className = 'rs-kb-results-header';
    header.textContent = `${entries.length} result${entries.length !== 1 ? 's' : ''}`;
    container.appendChild(header);

    for (const entry of entries) {
      const card = document.createElement('div');
      card.className = 'rs-kb-card';

      const titleRow = document.createElement('div');
      titleRow.className = 'rs-kb-card-title';

      const typeBadge = document.createElement('span');
      typeBadge.className = `rs-kb-type rs-kb-type-${entry.type}`;
      typeBadge.textContent = entry.type;
      titleRow.appendChild(typeBadge);

      const title = document.createElement('span');
      title.className = 'rs-kb-title-text';
      title.textContent = entry.title;
      titleRow.appendChild(title);
      card.appendChild(titleRow);

      if (entry.tags && entry.tags.length > 0) {
        const tagsRow = document.createElement('div');
        tagsRow.className = 'rs-kb-card-tags';
        for (const tag of entry.tags.slice(0, 5)) {
          const tagEl = document.createElement('span');
          tagEl.className = 'rs-kb-entry-tag';
          tagEl.textContent = tag;
          tagsRow.appendChild(tagEl);
        }
        card.appendChild(tagsRow);
      }

      card.addEventListener('click', () => {
        this._showKBDetail(entry);
      });

      container.appendChild(card);
    }
  },

  _showKBDetail(entry) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'rs-kb-detail-overlay';

    // Create modal card
    const modal = document.createElement('div');
    modal.className = 'rs-kb-detail-modal';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'rs-kb-detail-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => overlay.remove());
    modal.appendChild(closeBtn);

    // Header with type badge and title
    const header = document.createElement('div');
    header.className = 'rs-kb-detail-header';

    const typeBadge = document.createElement('span');
    typeBadge.className = `rs-kb-type rs-kb-type-${entry.type}`;
    typeBadge.textContent = entry.type;
    header.appendChild(typeBadge);

    const title = document.createElement('h2');
    title.className = 'rs-kb-detail-title';
    title.textContent = entry.title;
    header.appendChild(title);
    modal.appendChild(header);

    // Tags
    if (entry.tags && entry.tags.length > 0) {
      const tagsRow = document.createElement('div');
      tagsRow.className = 'rs-kb-detail-tags';
      for (const tag of entry.tags) {
        const tagEl = document.createElement('span');
        tagEl.className = 'rs-kb-entry-tag';
        tagEl.textContent = tag;
        tagsRow.appendChild(tagEl);
      }
      modal.appendChild(tagsRow);
    }

    // Source info
    const meta = document.createElement('div');
    meta.className = 'rs-kb-detail-meta';
    if (entry.sourceRoom) {
      meta.appendChild(document.createTextNode('Room: '));
      if (entry.sourceRoomId) {
        const roomLink = document.createElement('a');
        roomLink.className = 'kb-detail-room-link';
        roomLink.href = '/?room=' + encodeURIComponent(entry.sourceRoomId);
        roomLink.textContent = entry.sourceRoom;
        roomLink.title = 'Select this room';
        roomLink.addEventListener('click', (e) => {
          e.preventDefault();
          overlay.remove();
          // Auto-select on current page instead of new tab
          const listEl = document.getElementById('rs-room-list');
          if (listEl) {
            let target = null;
            listEl.querySelectorAll('.rs-room-item').forEach(el => {
              if (el.dataset.roomId === entry.sourceRoomId) target = el;
            });
            if (target) {
              listEl.querySelectorAll('.rs-room-item').forEach(el => el.classList.remove('selected'));
              target.classList.add('selected');
              target.scrollIntoView({ block: 'nearest' });
              const pwInput = document.getElementById('rs-join-password');
              if (pwInput) setTimeout(() => pwInput.focus(), 100);
            }
          }
        });
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
      const d = new Date(entry.timestamp);
      meta.appendChild(document.createTextNode(d.toLocaleString()));
    }
    modal.appendChild(meta);

    // Content (rendered as markdown)
    if (entry.content) {
      const contentEl = document.createElement('div');
      contentEl.className = 'rs-kb-detail-content';
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
            // fallback
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

      modal.appendChild(contentEl);
    }

    // References
    if (entry.references && entry.references.length > 0) {
      const refsLabel = document.createElement('div');
      refsLabel.className = 'rs-kb-detail-refs-label';
      refsLabel.textContent = 'References:';
      modal.appendChild(refsLabel);

      const refsList = document.createElement('div');
      refsList.className = 'rs-kb-detail-refs';
      for (const ref of entry.references) {
        const refEl = document.createElement('a');
        refEl.className = 'rs-kb-detail-ref';
        refEl.href = ref;
        refEl.target = '_blank';
        refEl.rel = 'noopener noreferrer';
        refEl.textContent = ref;
        refsList.appendChild(refEl);
      }
      modal.appendChild(refsList);
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    // Close on Escape key
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Clean up listener when modal is removed
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          if (node === overlay) {
            document.removeEventListener('keydown', escHandler);
            observer.disconnect();
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });
  }
};
