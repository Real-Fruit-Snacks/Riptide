window.Riptide = window.Riptide || {};

Riptide.Files = {
  _panel: null,
  _uploadBtn: null,
  _files: [],
  _dragCounter: 0,

  init() {
    this._panel = Riptide.CollapsiblePanel.create({
      sectionId: 'files-section',
      listId: 'files-list',
      headerId: 'files-header',
      chevronClass: 'files-chevron',
      badgeClass: 'files-badge',
      label: 'Files',
      startExpanded: false
    });

    // Upload button
    this._uploadBtn = document.createElement('button');
    this._uploadBtn.className = 'files-upload-btn';
    this._uploadBtn.textContent = '+';
    this._uploadBtn.title = 'Upload files';
    this._uploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._triggerUpload();
    });
    this._panel.header.appendChild(this._uploadBtn);

    // Server address input (for download commands)
    this._addrRow = document.createElement('div');
    this._addrRow.className = 'files-addr-row';
    const addrLabel = document.createElement('span');
    addrLabel.className = 'files-addr-label';
    addrLabel.textContent = 'Server:';
    this._addrInput = document.createElement('input');
    this._addrInput.type = 'text';
    this._addrInput.className = 'files-addr-input';
    this._addrInput.placeholder = 'e.g. 10.10.14.5 (port auto-added)';
    this._addrInput.value = localStorage.getItem('cw_server_addr') || '';
    this._addrInput.title = 'Reachable server address for download commands';
    this._addrInput.addEventListener('change', () => {
      const val = this._addrInput.value.trim().replace(/\/+$/, '');
      this._addrInput.value = val;
      if (val) {
        localStorage.setItem('cw_server_addr', val);
      } else {
        localStorage.removeItem('cw_server_addr');
      }
    });
    this._addrInput.addEventListener('click', (e) => e.stopPropagation());
    this._addrRow.appendChild(addrLabel);
    this._addrRow.appendChild(this._addrInput);
    this._panel.list.prepend(this._addrRow);

    // Drag-and-drop on the list area
    this._panel.list.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    this._panel.list.addEventListener('dragenter', (e) => {
      e.preventDefault();
      this._dragCounter++;
      this._panel.list.classList.add('files-dragover');
    });
    this._panel.list.addEventListener('dragleave', () => {
      this._dragCounter--;
      if (this._dragCounter <= 0) {
        this._dragCounter = 0;
        this._panel.list.classList.remove('files-dragover');
      }
    });
    this._panel.list.addEventListener('drop', (e) => {
      e.preventDefault();
      this._dragCounter = 0;
      this._panel.list.classList.remove('files-dragover');
      if (e.dataTransfer.files.length > 0) {
        this._uploadFiles(e.dataTransfer.files);
      }
    });

    // Wrap toggle to also hide/show the address row
    const origToggle = this._panel.toggle.bind(this._panel);
    this._panel.toggle = () => {
      origToggle();
      this._addrRow.classList.toggle('hidden', !this._panel.expanded);
    };
  },

  async load(tabId) {
    if (!tabId) tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) { this._files = []; this._render(); return; }
    try {
      this._files = await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/files`);
    } catch {
      this._files = [];
    }
    this._render();
  },

  _render() {
    this._panel.list.innerHTML = '';
    this._panel.badge.textContent = this._files.length > 0 ? this._files.length : '';

    // Evidence gallery for images
    const imageFiles = this._files.filter(f => this._isImage(f.name));

    // Remove any existing gallery
    const existingGallery = this._panel.list.parentNode.querySelector('.evidence-gallery');
    const existingGalleryHeader = this._panel.list.parentNode.querySelector('.evidence-gallery-header');
    if (existingGallery) existingGallery.remove();
    if (existingGalleryHeader) existingGalleryHeader.remove();

    if (imageFiles.length > 0) {
      const galleryHeader = document.createElement('div');
      galleryHeader.className = 'evidence-gallery-header';
      galleryHeader.textContent = 'Evidence ';

      const badge = document.createElement('span');
      badge.className = 'evidence-gallery-badge';
      badge.textContent = imageFiles.length;
      galleryHeader.appendChild(badge);

      const gallery = document.createElement('div');
      gallery.className = 'evidence-gallery';

      let galleryExpanded = true;
      galleryHeader.addEventListener('click', () => {
        galleryExpanded = !galleryExpanded;
        gallery.classList.toggle('hidden', !galleryExpanded);
      });

      for (const file of imageFiles) {
        const thumb = document.createElement('div');
        thumb.className = 'evidence-thumb';
        thumb.title = file.name;

        const imgUrl = this._getImageUrl(file.name);
        const img = document.createElement('img');
        img.src = imgUrl || '';
        img.alt = file.name;
        img.loading = 'lazy';
        if (!imgUrl) img.style.opacity = '0.3';

        const label = document.createElement('span');
        label.className = 'evidence-thumb-label';
        label.textContent = file.name;

        thumb.appendChild(img);
        thumb.appendChild(label);

        // Click to open lightbox
        thumb.addEventListener('click', () => {
          const url = this._getImageUrl(file.name);
          if (url && Riptide.Preview && Riptide.Preview._showImageLightbox) {
            Riptide.Preview._showImageLightbox(url, file.name);
          }
        });

        gallery.appendChild(thumb);
      }

      // Insert before the file list
      this._panel.list.parentNode.insertBefore(galleryHeader, this._panel.list);
      this._panel.list.parentNode.insertBefore(gallery, this._panel.list);
    }

    if (this._files.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'files-empty';
      empty.textContent = 'Drop files here or click + to upload';
      this._panel.list.appendChild(empty);
      return;
    }

    for (const file of this._files) {
      const row = document.createElement('div');
      row.className = 'files-entry';

      // File icon
      const icon = document.createElement('span');
      icon.className = 'files-icon';
      icon.textContent = this._getFileIcon(file.name);

      // File info
      const info = document.createElement('div');
      info.className = 'files-info';

      const nameEl = document.createElement('a');
      nameEl.className = 'files-name';
      nameEl.textContent = file.name;
      nameEl.title = 'Click to download';
      nameEl.href = '#';
      nameEl.addEventListener('click', (e) => {
        e.preventDefault();
        this._downloadFile(file.name);
      });

      const meta = document.createElement('span');
      meta.className = 'files-meta';
      meta.textContent = this._formatSize(file.size);

      info.appendChild(nameEl);
      info.appendChild(meta);

      // Actions wrapper
      const actions = document.createElement('div');
      actions.className = 'files-actions';

      // Copy download command button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'files-copy-btn';
      copyBtn.innerHTML = '&#8615;';
      copyBtn.title = 'Copy download command';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showDownloadCommands(file.name);
      });

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'files-del-btn';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete file';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await Riptide.Modal.confirm(
          'Delete file',
          `Delete "${file.name}"?`
        );
        if (confirmed) this._deleteFile(file.name);
      });

      actions.appendChild(copyBtn);
      actions.appendChild(delBtn);

      row.appendChild(icon);
      row.appendChild(info);
      row.appendChild(actions);
      this._panel.list.appendChild(row);
    }
  },

  _triggerUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', () => {
      if (input.files.length > 0) {
        this._uploadFiles(input.files);
      }
    });
    input.click();
  },

  async _uploadFiles(fileList) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;

    const formData = new FormData();
    for (let i = 0; i < fileList.length; i++) {
      formData.append('files', fileList[i]);
    }

    try {
      await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/files`, {
        method: 'POST',
        body: formData
      });
      Riptide.toast(`${fileList.length} file(s) uploaded`);
      await this.load(tabId);
    } catch (err) {
      Riptide.toast('Upload failed: ' + err.message);
    }
  },

  _downloadFile(filename) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;
    // Use fetch with auth header instead
    fetch(`/api/tabs/${encodeURIComponent(tabId)}/files/${encodeURIComponent(filename)}`, {
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

  async _deleteFile(filename) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;
    try {
      await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/files/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });
      this._files = this._files.filter(f => f.name !== filename);
      this._render();
    } catch {
      Riptide.toast('Failed to delete file');
    }
  },

  // Called by sync when files-changed arrives from another user
  onFilesChanged() {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (tabId) this.load(tabId);
  },

  async _showDownloadCommands(filename) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (!tabId) return;

    let base = localStorage.getItem('cw_server_addr') || window.location.origin;
    // Auto-prepend https:// if user entered bare IP/hostname
    if (base && !base.startsWith('http://') && !base.startsWith('https://')) {
      base = 'https://' + base;
    }
    // Auto-append port if missing and server uses non-standard port
    const port = window.location.port;
    if (port && port !== '80' && port !== '443') {
      try {
        const parsed = new URL(base);
        if (!parsed.port) {
          parsed.port = port;
          base = parsed.origin;
        }
      } catch { /* keep base as-is */ }
    }
    const url = `${base}/api/tabs/${encodeURIComponent(tabId)}/files/${encodeURIComponent(filename)}`;
    const token = Riptide.Auth.token;

    const shellEsc = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
    const safeFilename = shellEsc(filename);
    const psEsc = (s) => "'" + s.replace(/'/g, "''") + "'";
    const psFilename = psEsc(filename);

    const commands = {
      'curl': `curl -sk -H "Authorization: Bearer ${token}" -o ${safeFilename} "${url}"`,
      'curl.exe': `curl.exe -sk -H "Authorization: Bearer ${token}" -o ${safeFilename} "${url}"`,
      'wget': `wget --no-check-certificate --header="Authorization: Bearer ${token}" -O ${safeFilename} "${url}"`,
      'PowerShell': `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]'Tls,Tls11,Tls12';[Net.ServicePointManager]::ServerCertificateValidationCallback={param($a,$b,$c,$d)$true};Invoke-WebRequest -UseBasicParsing -Uri "${url}" -Headers @{Authorization="Bearer ${token}"} -OutFile ${psFilename}`,
    };

    const items = [
      { label: 'curl (Linux/macOS)', value: 'curl' },
      { label: 'curl.exe (Windows)', value: 'curl.exe' },
      { label: 'wget (Linux)', value: 'wget' },
      { label: 'PowerShell (Windows)', value: 'PowerShell' },
    ];

    const choice = await Riptide.Modal.pick('Copy Download Command', items);
    if (!choice) return;

    const cmd = commands[choice];
    Riptide.clipboard(cmd, `${choice} command`);
  },

  _getFileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const icons = {
      pdf: '\u{1F4C4}', doc: '\u{1F4C4}', docx: '\u{1F4C4}', txt: '\u{1F4C4}',
      png: '\u{1F5BC}', jpg: '\u{1F5BC}', jpeg: '\u{1F5BC}', gif: '\u{1F5BC}', svg: '\u{1F5BC}',
      zip: '\u{1F4E6}', tar: '\u{1F4E6}', gz: '\u{1F4E6}', rar: '\u{1F4E6}', '7z': '\u{1F4E6}',
      py: '\u{1F40D}', js: '\u2699', sh: '\u2699', rb: '\u2699', go: '\u2699',
      exe: '\u26A0', dll: '\u26A0', elf: '\u26A0', bin: '\u26A0',
      md: '\u{1F4DD}', csv: '\u{1F4CA}', json: '\u{1F4CB}', xml: '\u{1F4CB}', yaml: '\u{1F4CB}',
    };
    return icons[ext] || '\u{1F4CE}';
  },

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  },

  _isImage(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext);
  },

  _getImageUrl(filename) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    const token = Riptide.Preview ? Riptide.Preview._imageToken : null;
    if (!tabId || !token) return null;
    return '/api/tabs/' + encodeURIComponent(tabId) + '/files/' + encodeURIComponent(filename) + '?token=' + encodeURIComponent(token);
  }
};
