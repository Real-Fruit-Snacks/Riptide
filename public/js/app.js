window.Riptide = window.Riptide || {};

Riptide.App = {
  async init() {
    Riptide.Theme.init();
    Riptide.Modal.init();
    Riptide.Presence.init();

    // Try to restore session from stored token
    const restored = await Riptide.Auth.init();
    if (!restored) {
      await this._showRoomScreen();
    }

    // Now authenticated — show workspace, hide room screen
    document.getElementById('room-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    this._updateRoomInfo();

    Riptide.Splitter.init();
    Riptide.Terminal.init();
    Riptide.Variables.init();
    Riptide.History.init();
    Riptide.AuditLog.init();
    Riptide.ScratchPad.init();
    if (Riptide.Files) Riptide.Files.init();
    if (Riptide.Recordings) Riptide.Recordings.init();
    Riptide.Alerts.init();
    if (Riptide.Chat) Riptide.Chat.init();
    Riptide.Scope.init();
    Riptide.Credentials.init();
    if (Riptide.Knowledge) Riptide.Knowledge.init();
    Riptide.Playbooks.init();
    Riptide.Shortcuts.init();
    Riptide.Search.init();
    Riptide.Recorder.init();
    Riptide.Settings.init();

    // Panel tab switching
    const panelTabs = document.querySelectorAll('.panel-tab');
    panelTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.panel;
        // Update tab active state
        panelTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // Show/hide panel groups
        document.querySelectorAll('.panel-group').forEach(g => g.classList.add('hidden'));
        const group = document.getElementById('panel-group-' + target);
        if (group) group.classList.remove('hidden');
        // Clear chat notification dot when switching to Activity
        if (target === 'activity' && Riptide.Chat) {
          Riptide.Chat.hideActivityDot();
        }
      });
    });

    // Load tabs from server
    await Riptide.Tabs.load();

    // Load global (room-level) variables before first tab switch
    await Riptide.Variables.loadGlobalVars();

    // Load alert history
    await Riptide.Alerts.load();

    // Render tab bar
    this._renderTabBar();

    // Initialize terminal for each tab
    for (const tab of Riptide.Tabs.tabs) {
      Riptide.Terminal.initTab(tab.id);
    }

    // Activate the persisted active tab
    await this._switchTab(Riptide.Tabs.activeTabId, true);

    // Apply saved settings to terminal instances now that they exist
    Riptide.Settings.applyAll();

    // Tab bar: new tab button
    document.getElementById('btn-new-tab').addEventListener('click', () => this._createTab());

    // Leave room button
    document.getElementById('btn-leave-room').addEventListener('click', () => this._leaveRoom());

    // Capture output toolbar button
    document.getElementById('btn-capture-output').addEventListener('click', () => {
      const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
      this._captureOutput(tabId);
    });

    // Import playbook button
    document.getElementById('btn-import-playbook').addEventListener('click', () => {
      document.getElementById('playbook-import-input').click();
    });

    document.getElementById('playbook-import-input').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        Riptide.Playbooks._importPlaybooks(e.target.files);
        e.target.value = ''; // Reset so same file can be re-imported
      }
    });

    // Terminal sub-tab add button (always visible in terminal panel header)
    document.getElementById('btn-add-terminal').addEventListener('click', () => {
      const tabId = Riptide.Tabs.activeTabId;
      if (!tabId) return;
      const result = Riptide.Terminal.addSubTab(tabId);
      if (!result) {
        Riptide.toast('Maximum ' + Riptide.Terminal.MAX_SUB_TABS + ' terminals per tab');
        return;
      }
      this._renderTerminalTabs();
    });

    // Connect sync WebSocket
    Riptide.Sync.connect();

    // Show welcome guide on first join (not on session restore)
    if (!restored) {
      this._showWelcome();
    }
  },

  _showWelcome() {
    Riptide.Modal.info('Welcome to Riptide', `
      <div class="welcome-guide">
        <p class="welcome-tagline">A collaborative terminal and playbook workspace for penetration testing engagements.</p>
        <div class="welcome-tabs">
          <button class="welcome-tab active" data-tab="overview">Overview</button>
          <button class="welcome-tab" data-tab="playbooks">Playbooks</button>
          <button class="welcome-tab" data-tab="terminal">Terminal</button>
          <button class="welcome-tab" data-tab="collab">Collaboration</button>
          <button class="welcome-tab" data-tab="data">Data</button>
          <button class="welcome-tab" data-tab="tips">Tips</button>
        </div>
        <div class="welcome-panel active" data-panel="overview">
          <div class="welcome-features">
            <div class="welcome-feature">
              <span class="welcome-icon">&#9654;</span>
              <div><strong>Tabs</strong> &mdash; Each tab represents a target or workstream with its own terminal, playbooks, variables, and credentials. Click <strong>+</strong> to create, double-click to rename, click the status badge to cycle through phases.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#9881;</span>
              <div><strong>Variables</strong> &mdash; Use <code>&lt;VarName&gt;</code> syntax in code blocks. Values are set in the Variables panel and auto-substituted on Run. Supports tab-scoped and global scope.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#9971;</span>
              <div><strong>Credentials</strong> &mdash; Store service credentials with the vault. Supports tab and global scope, click-to-reveal secrets, and one-click export to files.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#9998;</span>
              <div><strong>Scratch Notes</strong> &mdash; Quick notes with severity levels (info through critical). Supports tab and global scope for per-target or team-wide notes.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#127919;</span>
              <div><strong>Target Scope</strong> &mdash; Track IP, hostname, OS, ports, and services per tab in the Scope panel. Auto-populated when promoting findings from output parsing.</div>
            </div>
          </div>
        </div>
        <div class="welcome-panel" data-panel="playbooks">
          <div class="welcome-features">
            <div class="welcome-feature">
              <span class="welcome-icon">&#128196;</span>
              <div><strong>Creating</strong> &mdash; Click <strong>+</strong> next to the search bar to create a blank playbook, or search the library for pre-built methodology templates.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#9654;</span>
              <div><strong>Running</strong> &mdash; Bash code blocks get a <strong>Run</strong> button (visible on hover). <strong>Run All</strong> executes every command in sequence. Output can be captured and saved inline.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#9745;</span>
              <div><strong>Checklists</strong> &mdash; Use <code>- [ ]</code> markdown syntax for interactive checklists. Clicking a checkbox persists the state automatically.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#9881;</span>
              <div><strong>Severity &amp; Reorder</strong> &mdash; Click the severity badge to classify findings (info &rarr; critical). Drag playbook sections to reorder them.</div>
            </div>
          </div>
        </div>
        <div class="welcome-panel" data-panel="terminal">
          <div class="welcome-features">
            <div class="welcome-feature">
              <span class="welcome-icon">&#62;&lowbar;</span>
              <div><strong>Persistent Sessions</strong> &mdash; Each tab has independent shell sessions that persist while the server runs. Late-joining users see buffered output.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#43;</span>
              <div><strong>Sub-Tabs</strong> &mdash; Click <strong>+</strong> in the terminal header to open multiple shells per tab (up to 8). Double-click a shell tab to rename it.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#8596;</span>
              <div><strong>Resizing</strong> &mdash; Drag the splitter between the left panel and terminal to resize. The terminal auto-fits to the available space.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#128247;</span>
              <div><strong>Output Capture</strong> &mdash; After running a command, click <strong>Capture</strong> to save terminal output directly into your playbook as an output block.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#128270;</span>
              <div><strong>Auto-Extract</strong> &mdash; Captured output is automatically scanned for IPs, URLs, emails, hashes, credentials, and open ports. Findings are highlighted inline with a toolbar to promote them to variables, credentials, or scope.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#9679;</span>
              <div><strong>Recording</strong> &mdash; Click the record button in the toolbar to capture terminal sessions. Auto-record can be enabled in Settings.</div>
            </div>
          </div>
        </div>
        <div class="welcome-panel" data-panel="collab">
          <div class="welcome-features">
            <div class="welcome-feature">
              <span class="welcome-icon">&#128101;</span>
              <div><strong>Real-Time Sync</strong> &mdash; All changes sync instantly across users in the room. Playbooks, variables, credentials, and notes update live.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#9873;</span>
              <div><strong>Flag Findings</strong> &mdash; Click the flag icon on any playbook, credential, or note to alert all teammates. Alerts appear as toasts and are saved in the Alerts panel.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#128274;</span>
              <div><strong>Edit Locking</strong> &mdash; When someone is editing a playbook, it locks for others to prevent conflicts. Locks release automatically when editing stops.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#127912;</span>
              <div><strong>Presence</strong> &mdash; Colored dots on tabs show where teammates are working. User avatars appear in the toolbar header.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#128172;</span>
              <div><strong>Chat</strong> &mdash; Real-time messaging in the Activity panel. Toggle between Global (room-wide) and Tab-scoped channels. Messages group by user with unread indicators and toast notifications.</div>
            </div>
          </div>
        </div>
        <div class="welcome-panel" data-panel="data">
          <div class="welcome-features">
            <div class="welcome-feature">
              <span class="welcome-icon">&#128218;</span>
              <div><strong>Knowledge Base</strong> &mdash; Persistent cross-room KB for techniques, tools, findings, and references. Click <strong>KB</strong> buttons on playbooks, credentials, notes, or alerts to promote entries. Search and filter by type or tag from the toolbar or login screen.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#128193;</span>
              <div><strong>Files</strong> &mdash; Upload evidence files per tab. View, download, or delete from the Files panel. Supports drag-and-drop.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#128203;</span>
              <div><strong>Reports</strong> &mdash; Generate a full engagement report from Settings &gt; Room &gt; Generate Report. Collects all playbooks, credentials, history, audit log, and notes. Option to include or redact credentials.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#128230;</span>
              <div><strong>Import/Export</strong> &mdash; Export entire room data as a zip archive from Settings. Import a previous export to restore or migrate engagements.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#128220;</span>
              <div><strong>Audit Log</strong> &mdash; Every command run through playbooks is logged with timestamp, user, and source playbook. View in the Activity panel.</div>
            </div>
          </div>
        </div>
        <div class="welcome-panel" data-panel="tips">
          <div class="welcome-features">
            <div class="welcome-feature">
              <span class="welcome-icon">&#9889;</span>
              <div><strong>Tab Status</strong> &mdash; Click the status badge on any tab to cycle through phases: <em>recon</em>, <em>exploit</em>, <em>post-exploit</em>, <em>pwned</em>, <em>blocked</em>.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#127760;</span>
              <div><strong>Global vs Tab Scope</strong> &mdash; Variables, credentials, and notes can be scoped to a single tab or shared globally across all tabs in the room.</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#9881;</span>
              <div><strong>Settings</strong> &mdash; Access via the gear icon in the toolbar. Configure terminal font size, cursor style, scrollback, editor preferences, and manage room data (rename, export, import, report, delete).</div>
            </div>
            <div class="welcome-feature">
              <span class="welcome-icon">&#9000;</span>
              <div><strong>Keyboard Shortcuts</strong> &mdash; Press <code>?</code> to view all shortcuts. <code>Ctrl+F</code> searches playbooks, <code>Ctrl+N</code> creates new playbooks, <code>Ctrl+T</code> creates new tabs, and more.</div>
            </div>
          </div>
        </div>
      </div>
    `);
    // Wire up welcome tabs after modal renders
    requestAnimationFrame(() => {
      const tabs = document.querySelectorAll('.welcome-tab');
      const panels = document.querySelectorAll('.welcome-panel');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          panels.forEach(p => p.classList.remove('active'));
          tab.classList.add('active');
          const target = document.querySelector(`.welcome-panel[data-panel="${tab.dataset.tab}"]`);
          if (target) target.classList.add('active');
        });
      });
    });
  },

  _updateRoomInfo() {
    const roomNameEl = document.getElementById('room-name');
    if (roomNameEl) {
      roomNameEl.textContent = Riptide.Auth.roomName || '';
    }
  },

  async _showRoomScreen() {
    const screen = document.getElementById('room-screen');
    const appEl = document.getElementById('app');
    screen.classList.remove('hidden');
    appEl.classList.add('hidden');

    await this._refreshRoomList();

    // Auto-select room from URL param (e.g. /?room=roomId from KB link)
    this._autoSelectRoomFromURL();

    // Initialize knowledge base search on login screen
    if (Riptide.Auth.initKBSearch) Riptide.Auth.initKBSearch();

    return new Promise((resolve) => {
      // Abort any previous room screen listeners to prevent accumulation
      if (this._roomScreenAbort) {
        this._roomScreenAbort.abort();
      }
      this._roomScreenAbort = new AbortController();
      const signal = this._roomScreenAbort.signal;

      const joinBtn = document.getElementById('rs-join-btn');
      const createBtn = document.getElementById('rs-create-btn');

      joinBtn.addEventListener('click', () => this._handleJoin(resolve), { signal });
      createBtn.addEventListener('click', () => this._handleCreate(resolve), { signal });

      // Allow Enter key in join inputs
      document.getElementById('rs-join-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinBtn.click();
      }, { signal });
      document.getElementById('rs-join-nickname').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinBtn.click();
      }, { signal });

      // Allow Enter key in create inputs
      document.getElementById('rs-create-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createBtn.click();
      }, { signal });
      document.getElementById('rs-create-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createBtn.click();
      }, { signal });
      document.getElementById('rs-create-nickname').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createBtn.click();
      }, { signal });

      // Wire up import file input to show filename
      const importFileInput = document.getElementById('rs-import-file');
      if (importFileInput) {
        importFileInput.addEventListener('change', () => {
          const nameSpan = document.getElementById('rs-import-filename');
          if (nameSpan) {
            nameSpan.textContent = importFileInput.files[0] ? importFileInput.files[0].name : '';
          }
        }, { signal });
      }
    });
  },

  _showArchived: false,
  _cachedRooms: null,

  async _refreshRoomList() {
    try {
      this._cachedRooms = await Riptide.Auth.listRooms();
    } catch {
      const listEl = document.getElementById('rs-room-list');
      listEl.innerHTML = '';
      const errEl = document.createElement('div');
      errEl.className = 'rs-empty';
      errEl.textContent = 'Failed to load rooms';
      listEl.appendChild(errEl);
      return;
    }
    this._renderRoomList();
  },

  _renderRoomList() {
    const listEl = document.getElementById('rs-room-list');
    const rooms = this._cachedRooms || [];

    // Build new content into a fragment, then swap in one shot
    const frag = document.createDocumentFragment();

    if (rooms.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'rs-empty';
      emptyEl.textContent = 'No rooms yet. Create one below.';
      frag.appendChild(emptyEl);
      listEl.innerHTML = '';
      listEl.appendChild(frag);
      return;
    }

    const active = rooms.filter(r => !Riptide.Auth.isArchived(r.id));
    const archived = rooms.filter(r => Riptide.Auth.isArchived(r.id));

    // Render active rooms
    if (active.length === 0 && archived.length > 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'rs-empty';
      emptyEl.textContent = 'All rooms are archived.';
      frag.appendChild(emptyEl);
    } else {
      for (const room of active) {
        frag.appendChild(this._buildRoomRow(room, false));
      }
    }

    // Archive toggle + archived rooms
    if (archived.length > 0) {
      const toggle = document.createElement('div');
      toggle.className = 'rs-archive-toggle';
      toggle.textContent = this._showArchived
        ? 'Hide archived rooms'
        : 'Show ' + archived.length + ' archived room' + (archived.length === 1 ? '' : 's');
      toggle.addEventListener('click', () => {
        this._showArchived = !this._showArchived;
        this._renderRoomList();
      });
      frag.appendChild(toggle);

      if (this._showArchived) {
        const divider = document.createElement('div');
        divider.className = 'rs-archive-divider';
        divider.textContent = 'Archived';
        frag.appendChild(divider);

        for (const room of archived) {
          frag.appendChild(this._buildRoomRow(room, true));
        }
      }
    }

    listEl.innerHTML = '';
    listEl.appendChild(frag);

  },

  _autoSelectRoomFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (!roomParam) return;

    const rooms = this._cachedRooms || [];
    const listEl = document.getElementById('rs-room-list');

    // If room is archived, unarchive it so it becomes visible
    if (rooms.find(r => r.id === roomParam) && Riptide.Auth.isArchived(roomParam)) {
      Riptide.Auth.setArchived(roomParam, false);
      this._renderRoomList();
    }

    // Find and select the room row
    let target = null;
    listEl.querySelectorAll('.rs-room-item').forEach(el => {
      if (el.dataset.roomId === roomParam) target = el;
    });

    if (target) {
      listEl.querySelectorAll('.rs-room-item').forEach(el => el.classList.remove('selected'));
      target.classList.add('selected');
      target.scrollIntoView({ block: 'nearest' });
      const pwInput = document.getElementById('rs-join-password');
      if (pwInput) setTimeout(() => pwInput.focus(), 100);
    }

    // Clean URL param
    const url = new URL(window.location);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.pathname);
  },

  _buildRoomRow(room, isArchived) {
    const row = document.createElement('div');
    row.className = 'rs-room-item' + (isArchived ? ' rs-archived' : '');
    row.dataset.roomId = room.id;

    const info = document.createElement('div');
    info.className = 'rs-room-info';

    const name = document.createElement('span');
    name.className = 'rs-room-name';
    name.textContent = room.name;

    const users = document.createElement('span');
    users.className = 'rs-room-users';
    users.textContent = room.userCount + (room.userCount === 1 ? ' user' : ' users');

    info.appendChild(name);
    info.appendChild(users);

    const archiveBtn = document.createElement('button');
    archiveBtn.className = 'rs-archive-btn';
    archiveBtn.textContent = isArchived ? 'Unarchive' : 'Archive';
    archiveBtn.title = isArchived ? 'Move back to active rooms' : 'Hide from room list';
    archiveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Riptide.Auth.setArchived(room.id, !isArchived);
      this._renderRoomList();
    });

    row.appendChild(info);
    row.appendChild(archiveBtn);

    row.addEventListener('click', () => {
      const listEl = document.getElementById('rs-room-list');
      listEl.querySelectorAll('.rs-room-item').forEach(el => el.classList.remove('selected'));
      row.classList.add('selected');
    });

    return row;
  },

  async _handleJoin(resolve) {
    const selected = document.querySelector('.rs-room-item.selected');
    const password = document.getElementById('rs-join-password').value;
    const nickname = document.getElementById('rs-join-nickname').value.trim();
    const errorEl = document.getElementById('rs-join-error');

    errorEl.textContent = '';

    if (!selected) {
      errorEl.textContent = 'Select a room first';
      return;
    }
    if (!password) {
      errorEl.textContent = 'Password is required';
      return;
    }
    if (password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters';
      return;
    }
    if (!nickname) {
      errorEl.textContent = 'Nickname is required';
      return;
    }

    const btn = document.getElementById('rs-join-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Joining...';

    try {
      await Riptide.Auth.joinRoom(selected.dataset.roomId, password, nickname);
      btn.disabled = false;
      btn.textContent = originalText;
      resolve();
    } catch (err) {
      errorEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = originalText;
    }
  },

  async _handleCreate(resolve) {
    const name = document.getElementById('rs-create-name').value.trim();
    const password = document.getElementById('rs-create-password').value;
    const nickname = document.getElementById('rs-create-nickname').value.trim();
    const workDir = document.getElementById('rs-create-workdir').value.trim();
    const errorEl = document.getElementById('rs-create-error');

    errorEl.textContent = '';

    if (!name) {
      errorEl.textContent = 'Room name is required';
      return;
    }
    if (!password) {
      errorEl.textContent = 'Password is required';
      return;
    }
    if (password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters';
      return;
    }
    if (!nickname) {
      errorEl.textContent = 'Nickname is required';
      return;
    }

    const btn = document.getElementById('rs-create-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
      const data = await Riptide.Auth.createRoom(name, password, nickname, workDir || null);

      // If an import file was attached, upload it
      const importFile = document.getElementById('rs-import-file').files[0];
      if (importFile) {
        try {
          await Riptide.Auth.importRoom(data.room.id, data.token, importFile);
        } catch (importErr) {
          console.error('Import failed:', importErr);
        }
      }

      btn.disabled = false;
      btn.textContent = originalText;
      resolve();
    } catch (err) {
      errorEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = originalText;
    }
  },

  async _leaveRoom() {
    const confirmed = await Riptide.Modal.confirm(
      'Leave Room',
      'Leave the current room? You can rejoin later with the password.',
      'Leave'
    );
    if (!confirmed) return;

    Riptide.Sync.disconnect();
    await Riptide.Auth.leave();
    location.reload();
  },

  // --- Tab bar rendering ---
  _renderTabBar() {
    const bar = document.getElementById('tab-bar');
    bar.querySelectorAll('.tab-item').forEach(el => el.remove());

    const addBtn = document.getElementById('btn-new-tab');

    Riptide.Tabs.tabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab-item' + (tab.id === Riptide.Tabs.activeTabId ? ' active' : '');
      tabEl.dataset.tabId = tab.id;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tab-name';
      nameSpan.textContent = tab.name;
      nameSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this._renameTab(tab.id);
      });
      tabEl.appendChild(nameSpan);

      // Status badge
      const statusBadge = document.createElement('span');
      statusBadge.className = 'tab-status-badge';
      this._applyTabStatus(statusBadge, tab.status);
      statusBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        this._cycleTabStatus(tab.id);
      });
      tabEl.appendChild(statusBadge);

      // Close button (only if more than 1 tab)
      if (Riptide.Tabs.tabs.length > 1) {
        const closeBtn = document.createElement('span');
        closeBtn.className = 'tab-close';
        closeBtn.textContent = '\u00d7';
        closeBtn.title = 'Close tab';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._deleteTab(tab.id);
        });
        tabEl.appendChild(closeBtn);
      }

      if (tab.status) tabEl.classList.add('tab-st-' + tab.status);

      tabEl.addEventListener('click', () => this._switchTab(tab.id));

      bar.insertBefore(tabEl, addBtn);
    });

    // Re-render presence dots on tab items
    Riptide.Presence._renderTabDots();
  },

  // --- Tab operations ---
  async _createTab() {
    const name = await Riptide.Modal.prompt('New tab name', 'New Tab');
    if (!name) return;

    try {
      const tab = await Riptide.Tabs.create(name);
      Riptide.Terminal.initTab(tab.id);
      this._renderTabBar();
      await this._switchTab(tab.id);
    } catch (err) {
      await Riptide.Modal.alert('Error', err.message);
    }
  },

  async _deleteTab(tabId) {
    if (Riptide.Tabs.tabs.length <= 1) return;
    const tab = Riptide.Tabs.tabs.find(t => t.id === tabId);
    const confirmed = await Riptide.Modal.confirm(
      'Delete tab',
      `Delete "${tab ? tab.name : 'this tab'}" and all its playbooks?`
    );
    if (!confirmed) return;

    // Disable the close button to prevent double-clicks
    const tabEl = document.querySelector(`.tab-item[data-tab-id="${CSS.escape(tabId)}"]`);
    const closeBtn = tabEl ? tabEl.querySelector('.tab-close') : null;
    if (closeBtn) closeBtn.style.pointerEvents = 'none';

    try {
      await Riptide.Tabs.remove(tabId);
      Riptide.Terminal.destroyTab(tabId);
      if (Riptide.Recorder && Riptide.Recorder._recordings) {
        Riptide.Recorder._recordings.delete(tabId);
      }
      this._renderTabBar();

      // Switch to first remaining tab
      const remaining = Riptide.Tabs.tabs[0];
      await this._switchTab(remaining.id);
    } catch (err) {
      if (closeBtn) closeBtn.style.pointerEvents = '';
      await Riptide.Modal.alert('Error', err.message);
    }
  },

  async _renameTab(tabId) {
    const tab = Riptide.Tabs.tabs.find(t => t.id === tabId);
    const name = await Riptide.Modal.prompt('Rename tab', tab ? tab.name : '');
    if (!name) return;

    try {
      await Riptide.Tabs.rename(tabId, name);
      this._renderTabBar();
    } catch (err) {
      await Riptide.Modal.alert('Error', err.message);
    }
  },

  _applyTabStatus(badge, status) {
    // Remove old status classes
    badge.className = 'tab-status-badge';
    if (status) {
      badge.classList.add('tab-status-' + status);
      badge.textContent = this._statusLabel(status);
      badge.title = 'Status: ' + status + ' — click to change';
    } else {
      badge.textContent = '';
      badge.title = 'Set status — click to assign';
    }
  },

  _statusLabel(status) {
    const labels = {
      'recon': 'REC',
      'exploit': 'EXP',
      'post-exploit': 'PST',
      'pwned': 'PWN',
      'blocked': 'BLK'
    };
    return labels[status] || '';
  },

  async _cycleTabStatus(tabId) {
    const statuses = [null, 'recon', 'exploit', 'post-exploit', 'pwned', 'blocked'];
    const tab = Riptide.Tabs.tabs.find(t => t.id === tabId);
    if (!tab) return;

    const currentIdx = statuses.indexOf(tab.status || null);
    const nextIdx = (currentIdx + 1) % statuses.length;
    const newStatus = statuses[nextIdx];

    tab.status = newStatus;

    // Update badge immediately (optimistic)
    const tabEl = document.querySelector(`.tab-item[data-tab-id="${CSS.escape(tabId)}"]`);
    if (tabEl) {
      const badge = tabEl.querySelector('.tab-status-badge');
      if (badge) this._applyTabStatus(badge, newStatus);

      // Update tab-item border color
      tabEl.classList.remove('tab-st-recon', 'tab-st-exploit', 'tab-st-post-exploit', 'tab-st-pwned', 'tab-st-blocked');
      if (newStatus) tabEl.classList.add('tab-st-' + newStatus);
    }

    // Save to server
    try {
      await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}`, {
        method: 'PATCH',
        body: { status: newStatus }
      });
    } catch {
      Riptide.toast('Failed to update tab status');
    }
  },

  async _captureOutput(tabId) {
    const id = tabId || (Riptide.Tabs ? Riptide.Tabs.activeTabId : null);
    if (!id) return;

    let output;
    try {
      output = await navigator.clipboard.readText();
    } catch {
      // Clipboard API denied — fall back to manual paste
      output = await Riptide.Modal.prompt('Paste captured output');
    }

    if (!output || !output.trim()) {
      Riptide.toast('Clipboard is empty — copy terminal output first');
      return;
    }
    output = output.trim();

    const items = [
      { label: 'Append to existing playbook', value: 'existing' },
      { label: 'Create new playbook', value: 'new' },
      { label: 'Save as scratch note', value: 'scratch' }
    ];
    const choice = await Riptide.Modal.pick('Capture Output', items);

    if (choice === 'existing') {
      await this._captureToExistingNote(id, output);
    } else if (choice === 'new') {
      await this._captureToNewNote(id, output);
    } else if (choice === 'scratch') {
      await Riptide.ScratchPad.addNote('## Captured Output\n\n```\n' + output + '\n```');
      Riptide.toast('Output saved to scratch notes');
    }
  },

  async _captureToExistingNote(tabId, output) {
    // Get current playbook sections
    const sections = Riptide.Playbooks.sections;
    if (!sections || sections.size === 0) {
      Riptide.toast('No playbooks open to append to');
      return;
    }

    // Build list of note titles for user to pick
    const noteNames = [];
    for (const [noteId, section] of sections) {
      noteNames.push({ id: noteId, name: section.title || noteId });
    }

    if (noteNames.length === 1) {
      // Only one note — append directly
      await this._appendCapture(tabId, noteNames[0].id, output);
      return;
    }

    // Multiple notes — let user pick from clickable list
    const items = noteNames.map(n => ({ label: n.name, value: n.id }));
    const selectedId = await Riptide.Modal.pick('Append to which note?', items);
    if (!selectedId) return;

    await this._appendCapture(tabId, selectedId, output);
  },

  async _appendCapture(tabId, noteId, output) {
    const content = '\n\n## Captured Output\n\n```\n' + output + '\n```\n';

    try {
      await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/notes/${encodeURIComponent(noteId)}/append`, {
        method: 'POST',
        body: { content }
      });

      // Refresh the playbook section if it's expanded
      const section = Riptide.Playbooks.sections.get(noteId);
      if (section && section.expanded) {
        try {
          const data = await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}/notes/${encodeURIComponent(noteId)}`);
          section.content = data.content;
          const contentDiv = section.el.querySelector('.pb-content');
          if (contentDiv) {
            Riptide.Preview.render(contentDiv, data.content);
          }
        } catch {
          // ignore refresh failure
        }
      }

      Riptide.toast('Output captured');
    } catch (err) {
      await Riptide.Modal.alert('Error', err.message);
    }
  },

  async _captureToNewNote(tabId, output) {
    const title = await Riptide.Modal.prompt('New note title', 'Captured Output');
    if (!title) return;

    const content = '# ' + title + '\n\n## Terminal Output\n\n```\n' + output + '\n```\n';

    try {
      const note = await Riptide.Notes.create(tabId, title, content);

      // Add section to playbook stack (same pattern as Playbooks._addFromLibrary)
      const sectionEl = Riptide.Playbooks._buildSection(note.id, note.title);
      document.getElementById('playbook-stack').appendChild(sectionEl);

      Riptide.Playbooks.sections.set(note.id, {
        noteId: note.id,
        title: note.title,
        content: note.content,
        mode: 'view',
        expanded: false,
        saveTimeout: null,
        severity: null,
        el: sectionEl
      });

      await Riptide.Playbooks._expandSection(note.id);
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      Riptide.toast('Output saved to new note');
    } catch (err) {
      await Riptide.Modal.alert('Error', err.message);
    }
  },

  async _switchTab(tabId, isInit) {
    // Save any dirty playbook editors before switching
    if (!isInit) {
      await Riptide.Playbooks._saveAllDirty();
    }

    // Capture previous tab ID before switching
    const previousTabId = Riptide.Tabs.activeTabId;

    // Persist active tab to server
    await Riptide.Tabs.setActiveTab(tabId);

    // Switch terminal
    Riptide.Terminal.switchTo(tabId);

    // Load the playbook stack first (main content area)
    await Riptide.Playbooks.loadStack(previousTabId);

    // Load remaining modules in parallel
    await Promise.all([
      Riptide.History.load(tabId),
      Riptide.AuditLog.load(tabId),
      Riptide.ScratchPad.load(tabId),
      Riptide.Files ? Riptide.Files.load(tabId) : Promise.resolve(),
      Riptide.Recordings ? Riptide.Recordings.load(tabId) : Promise.resolve(),
      Riptide.Scope.load(tabId),
      Riptide.Credentials.load(tabId),
      Riptide.Chat ? Riptide.Chat.load(tabId).then(() => Riptide.Chat.checkTabUnreads(tabId)) : Promise.resolve(),
    ]);

    // Notify others which tab we're on
    Riptide.Sync.sendTabSwitch(tabId);

    // Auto-start recording for this tab
    Riptide.Recorder.onTabSwitch(tabId);

    // Update tab bar active state
    this._renderTabBar();

    // Render terminal sub-tab bar
    this._renderTerminalTabs();
  },

  _renderTerminalTabs() {
    const bar = document.getElementById('terminal-tabs');
    const tabId = Riptide.Tabs.activeTabId;
    if (!tabId) {
      bar.classList.add('hidden');
      return;
    }

    const subTabs = Riptide.Terminal.getSubTabs(tabId);

    // Hide bar when only 1 sub-tab
    if (subTabs.length <= 1) {
      bar.classList.add('hidden');
      return;
    }

    bar.classList.remove('hidden');
    bar.innerHTML = '';

    for (const st of subTabs) {
      const tabEl = document.createElement('div');
      tabEl.className = 'terminal-tab-item' + (st.active ? ' active' : '');
      tabEl.dataset.subTabId = st.subTabId;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'terminal-tab-name';
      nameSpan.textContent = st.name;
      nameSpan.title = st.name + ' (double-click to rename)';
      nameSpan.addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        const newName = await Riptide.Modal.prompt('Rename terminal', st.name);
        if (newName) {
          Riptide.Terminal.renameSubTab(tabId, st.subTabId, newName);
          this._renderTerminalTabs();
        }
      });
      tabEl.appendChild(nameSpan);

      // Close button (only if more than 1 sub-tab)
      if (subTabs.length > 1) {
        const closeBtn = document.createElement('span');
        closeBtn.className = 'terminal-tab-close';
        closeBtn.textContent = '\u00d7';
        closeBtn.title = 'Close terminal';
        closeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const confirmed = await Riptide.Modal.confirm(
            'Close terminal',
            `Close "${st.name}"? The shell session will be lost.`,
            'Close'
          );
          if (!confirmed) return;
          Riptide.Terminal.removeSubTab(tabId, st.subTabId);
          this._renderTerminalTabs();
        });
        tabEl.appendChild(closeBtn);
      }

      tabEl.addEventListener('click', () => {
        if (st.active) return; // Already active — don't re-render (allows dblclick to fire)
        Riptide.Terminal.switchSubTab(tabId, st.subTabId);
        this._renderTerminalTabs();
      });

      bar.appendChild(tabEl);
    }

    // Add button at end of tab bar (hide if at max)
    if (subTabs.length < Riptide.Terminal.MAX_SUB_TABS) {
      const addBtn = document.createElement('button');
      addBtn.className = 'terminal-tab-add-btn';
      addBtn.textContent = '+';
      addBtn.title = 'New terminal';
      addBtn.addEventListener('click', () => {
        Riptide.Terminal.addSubTab(tabId);
        this._renderTerminalTabs();
      });
      bar.appendChild(addBtn);
    }

    // Scroll active sub-tab into view
    const activeEl = bar.querySelector('.terminal-tab-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Riptide.App.init().catch(err => console.error('Init failed:', err));
});
