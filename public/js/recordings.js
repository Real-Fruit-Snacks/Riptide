window.Riptide = window.Riptide || {};

Riptide.Recordings = {
  _panel: null,
  _recordings: [],

  init() {
    this._panel = Riptide.CollapsiblePanel.create({
      sectionId: 'recordings-section',
      listId: 'recordings-list',
      headerId: 'recordings-header',
      chevronClass: 'recordings-chevron',
      badgeClass: 'recordings-badge',
      label: 'Recordings',
      startExpanded: false
    });
  },

  async load(tabId) {
    if (!tabId) tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) { this._recordings = []; this._render(); return; }
    try {
      this._recordings = await Riptide.api('/api/tabs/' + encodeURIComponent(tabId) + '/recordings');
    } catch {
      this._recordings = [];
    }
    this._render();
  },

  _render() {
    this._panel.list.innerHTML = '';
    this._panel.badge.textContent = this._recordings.length > 0 ? this._recordings.length : '';

    if (this._recordings.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recordings-empty';
      empty.textContent = 'No saved recordings';
      this._panel.list.appendChild(empty);
      return;
    }

    for (const rec of this._recordings) {
      const row = document.createElement('div');
      row.className = 'recordings-entry';

      // Icon
      const icon = document.createElement('span');
      icon.className = 'recordings-icon';
      icon.textContent = '\u23FA'; // record symbol ⏺

      // Info
      const info = document.createElement('div');
      info.className = 'recordings-info';

      const nameEl = document.createElement('a');
      nameEl.className = 'recordings-name';
      nameEl.textContent = rec.name;
      nameEl.title = 'Click to play';
      nameEl.href = '#';
      nameEl.addEventListener('click', (e) => {
        e.preventDefault();
        this._play(rec.name);
      });

      const meta = document.createElement('span');
      meta.className = 'recordings-meta';
      meta.textContent = this._formatSize(rec.size);
      if (rec.modified) {
        const date = new Date(rec.modified);
        meta.textContent += ' \u00B7 ' + date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      info.appendChild(nameEl);
      info.appendChild(meta);

      // Actions
      const actions = document.createElement('div');
      actions.className = 'recordings-actions';

      // Play button
      const playBtn = document.createElement('button');
      playBtn.className = 'recordings-play-btn';
      playBtn.innerHTML = '&#9654;'; // ▶
      playBtn.title = 'Play recording';
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._play(rec.name);
      });

      // Download button
      const dlBtn = document.createElement('button');
      dlBtn.className = 'recordings-dl-btn';
      dlBtn.innerHTML = '&#8615;'; // ⇩
      dlBtn.title = 'Download .cast file';
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._download(rec.name);
      });

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'recordings-del-btn';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete recording';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await Riptide.Modal.confirm(
          'Delete recording',
          'Delete "' + rec.name + '"?'
        );
        if (confirmed) this._deleteRecording(rec.name);
      });

      actions.appendChild(playBtn);
      actions.appendChild(dlBtn);
      actions.appendChild(delBtn);

      row.appendChild(icon);
      row.appendChild(info);
      row.appendChild(actions);
      this._panel.list.appendChild(row);
    }
  },

  async _play(filename) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;

    try {
      const res = await fetch('/api/tabs/' + encodeURIComponent(tabId) + '/recordings/' + encodeURIComponent(filename), {
        headers: { 'Authorization': 'Bearer ' + Riptide.Auth.token }
      });
      if (!res.ok) throw new Error('Failed to load recording');

      const text = await res.text();
      const lines = text.trim().split('\n');
      if (lines.length < 2) {
        Riptide.toast('Recording is empty');
        return;
      }

      const header = JSON.parse(lines[0]);
      const events = [];
      for (let i = 1; i < lines.length; i++) {
        events.push(JSON.parse(lines[i]));
      }

      // Use the Recorder's playback method
      Riptide.Recorder._playback({
        cols: header.width || 80,
        rows: header.height || 24,
        startTime: (header.timestamp || 0) * 1000,
        events: events
      });
    } catch (err) {
      Riptide.toast('Failed to play recording: ' + err.message);
    }
  },

  _download(filename) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;

    fetch('/api/tabs/' + encodeURIComponent(tabId) + '/recordings/' + encodeURIComponent(filename), {
      headers: { 'Authorization': 'Bearer ' + Riptide.Auth.token }
    })
      .then(res => {
        if (!res.ok) throw new Error('Download failed');
        return res.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      })
      .catch(() => {
        Riptide.toast('Download failed');
      });
  },

  async _deleteRecording(filename) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;
    try {
      await Riptide.api('/api/tabs/' + encodeURIComponent(tabId) + '/recordings/' + encodeURIComponent(filename), {
        method: 'DELETE'
      });
      this._recordings = this._recordings.filter(r => r.name !== filename);
      this._render();
    } catch {
      Riptide.toast('Failed to delete recording');
    }
  },

  onRecordingChanged() {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (tabId) this.load(tabId);
  },

  _formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }
};
