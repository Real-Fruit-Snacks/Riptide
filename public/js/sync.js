window.Riptide = window.Riptide || {};

Riptide.Sync = {
  _ws: null,
  _reconnectTimer: null,
  _hasConnectedOnce: false,
  _reconnectDelay: 2000,

  connect() {
    if (this._ws) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws/sync`);
    this._ws = ws;

    ws.onopen = () => {
      const isReconnect = this._hasConnectedOnce;
      this._hasConnectedOnce = true;
      // Reset reconnect delay on successful connection
      this._reconnectDelay = 2000;

      ws.send(JSON.stringify({
        type: 'auth',
        token: Riptide.Auth.token,
        activeTabId: Riptide.Tabs.activeTabId
      }));

      if (isReconnect) {
        this._refreshState();
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this._handleEvent(msg);
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      this._ws = null;
      clearTimeout(this._reconnectTimer);
      if (Riptide.Auth.token) {
        const delay = this._reconnectDelay;
        this._reconnectDelay = Math.min(delay * 2, 30000);
        this._reconnectTimer = setTimeout(() => this.connect(), delay);
      }
    };

    ws.onerror = () => {};
  },

  sendTabSwitch(tabId) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type: 'tab-switch', tabId }));
    }
  },

  sendNoteEditing(tabId, noteId) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type: 'note-editing', tabId, noteId }));
    }
  },

  sendNoteEditDone(tabId, noteId) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type: 'note-edit-done', tabId, noteId }));
    }
  },

  disconnect() {
    clearTimeout(this._reconnectTimer);
    this._hasConnectedOnce = false;
    this._reconnectDelay = 2000;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  },

  _handleEvent(msg) {
    switch (msg.type) {
      case 'tab-created':       this._onTabCreated(msg); break;
      case 'tab-deleted':       this._onTabDeleted(msg); break;
      case 'tab-renamed':       this._onTabRenamed(msg); break;
      case 'tab-status-changed': this._onTabStatusChanged(msg); break;
      case 'note-created':      this._onNoteCreated(msg); break;
      case 'note-updated':      this._onNoteUpdated(msg); break;
      case 'note-deleted':      this._onNoteDeleted(msg); break;
      case 'notes-reordered':   this._onNotesReordered(msg); break;
      case 'variables-changed': this._onVariablesChanged(msg); break;
      case 'scope-changed':     this._onScopeChanged(msg); break;
      case 'global-variables-changed':
        if (Riptide.Variables) Riptide.Variables.setGlobalVars(msg.variables);
        break;
      case 'command-logged':    this._onCommandLogged(msg); break;
      case 'history-cleared':   this._onHistoryCleared(msg); break;
      case 'audit-logged':      this._onAuditLogged(msg); break;
      case 'audit-cleared':     this._onAuditCleared(msg); break;
      case 'scratch-note-created':  this._onScratchNoteCreated(msg); break;
      case 'scratch-note-updated':  this._onScratchNoteUpdated(msg); break;
      case 'scratch-note-deleted':  this._onScratchNoteDeleted(msg); break;
      case 'scratch-note-severity-changed': this._onScratchNoteSeverityChanged(msg); break;
      case 'credential-created':
        if (Riptide.Credentials && msg.tabId === Riptide.Tabs.activeTabId) {
          Riptide.Credentials.addEntry(msg.credential);
        }
        break;
      case 'credential-updated':
        if (Riptide.Credentials && msg.tabId === Riptide.Tabs.activeTabId) {
          Riptide.Credentials.updateEntry(msg.credential);
        }
        break;
      case 'credential-deleted':
        if (Riptide.Credentials && msg.tabId === Riptide.Tabs.activeTabId) {
          Riptide.Credentials.removeEntry(msg.credentialId);
        }
        break;
      case 'global-credential-created':
        if (Riptide.Credentials) Riptide.Credentials.addGlobalEntry(msg.credential);
        break;
      case 'global-credential-updated':
        if (Riptide.Credentials) Riptide.Credentials.updateGlobalEntry(msg.credential);
        break;
      case 'global-credential-deleted':
        if (Riptide.Credentials) Riptide.Credentials.removeGlobalEntry(msg.credentialId);
        break;
      case 'files-changed':
        if (Riptide.Files) Riptide.Files.onFilesChanged();
        break;
      case 'recording-saved':
      case 'recording-deleted':
        if (Riptide.Recordings) Riptide.Recordings.onRecordingChanged();
        break;
      case 'finding-flagged':
        this._onFindingFlagged(msg);
        if (Riptide.Alerts) Riptide.Alerts.addEntry(msg);
        break;
      case 'alerts-cleared':
        if (Riptide.Alerts) Riptide.Alerts.clearEntries();
        break;
      case 'chat-message':
        if (Riptide.Chat) {
          const isActiveTab = msg.scope === 'global' || msg.tabId === Riptide.Tabs.activeTabId;
          if (msg.scope === Riptide.Chat._scope && isActiveTab) {
            Riptide.Chat.addMessage(msg.entry, msg.scope);
          } else if (msg.scope === 'tab' && !isActiveTab) {
            Riptide.Chat.trackTabUnread(msg.tabId);
          }
        }
        break;
      case 'knowledge-created':
        if (Riptide.Knowledge) Riptide.Knowledge.onKnowledgeCreated(msg.entry);
        break;
      case 'knowledge-updated':
        if (Riptide.Knowledge) Riptide.Knowledge.onKnowledgeUpdated(msg.entry);
        break;
      case 'knowledge-deleted':
        if (Riptide.Knowledge) Riptide.Knowledge.onKnowledgeDeleted(msg.entryId);
        break;
      case 'note-severity-changed':
        if (Riptide.Playbooks) {
          Riptide.Playbooks._setSeverity(msg.noteId, msg.severity);
        }
        break;
      case 'note-editing':      this._onNoteEditing(msg); break;
      case 'note-edit-done':    this._onNoteEditDone(msg); break;
      case 'note-lock-denied':  this._onNoteLockDenied(msg); break;
      case 'edit-locks':        this._onEditLocks(msg); break;
      case 'room-renamed':      this._onRoomRenamed(msg); break;
      case 'room-deleted':      this._onRoomDeleted(); break;
      case 'session-reset':     this._onSessionReset(); break;
      case 'tab-switch':        Riptide.Presence.setUserTab(msg.nickname, msg.tabId); break;
      case 'users':             Riptide.Presence.update(msg.users); break;
      case 'user-joined':       Riptide.Presence.addUser(msg); Riptide.toast(`${msg.nickname} joined the room`); break;
      case 'user-left':         Riptide.Presence.removeUser(msg.nickname); Riptide.toast(`${msg.nickname} left the room`); break;
    }
  },

  _onTabCreated(msg) {
    Riptide.Tabs.tabs.push(msg.tab);
    Riptide.Terminal.initTab(msg.tab.id);
    Riptide.App._renderTabBar();
  },

  _onTabDeleted(msg) {
    Riptide.Tabs.tabs = Riptide.Tabs.tabs.filter(t => t.id !== msg.tabId);
    Riptide.Terminal.destroyTab(msg.tabId);
    if (Riptide.Recorder && Riptide.Recorder._recordings) {
      Riptide.Recorder._recordings.delete(msg.tabId);
    }
    if (Riptide.Tabs.activeTabId === msg.tabId && Riptide.Tabs.tabs.length > 0) {
      Riptide.App._switchTab(Riptide.Tabs.tabs[0].id);
    } else {
      Riptide.App._renderTabBar();
    }
  },

  _onTabRenamed(msg) {
    const tab = Riptide.Tabs.tabs.find(t => t.id === msg.tabId);
    if (tab) tab.name = msg.name;
    Riptide.App._renderTabBar();
  },

  _onTabStatusChanged(msg) {
    const tab = Riptide.Tabs.tabs.find(t => t.id === msg.tabId);
    if (tab) tab.status = msg.status;
    Riptide.App._renderTabBar();
  },

  _onNoteCreated(msg) {
    if (msg.tabId !== Riptide.Tabs.activeTabId) return;
    if (Riptide.Playbooks.sections.has(msg.note.id)) return;

    const sectionEl = Riptide.Playbooks._buildSection(msg.note.id, msg.note.title);
    document.getElementById('playbook-stack').appendChild(sectionEl);

    Riptide.Playbooks.sections.set(msg.note.id, {
      noteId: msg.note.id,
      title: msg.note.title,
      content: msg.note.content || null,
      mode: 'view',
      expanded: false,
      saveTimeout: null,
      severity: msg.note.severity || null,
      el: sectionEl
    });
  },

  _onNoteUpdated(msg) {
    if (msg.tabId !== Riptide.Tabs.activeTabId) return;
    const section = Riptide.Playbooks.sections.get(msg.noteId);
    if (!section) return;
    if (section.mode === 'edit') {
      // Store remote content and show conflict warning
      section._remoteContent = msg.content;
      Riptide.Playbooks._showConflictIndicator(msg.noteId, msg.user);
      return;
    }
    section.content = msg.content;
    if (section.expanded) {
      const contentDiv = section.el.querySelector('.pb-content');
      Riptide.Preview.render(contentDiv, section.content);
      Riptide.Variables.refresh();
    }
  },

  _onNoteDeleted(msg) {
    if (msg.tabId !== Riptide.Tabs.activeTabId) return;
    const section = Riptide.Playbooks.sections.get(msg.noteId);
    if (!section) return;

    // If local user is editing this note, force-exit without saving (note is gone)
    if (section.mode === 'edit') {
      clearTimeout(section.saveTimeout);
      section.mode = 'view';
      // Destroy CodeMirror editor if open
      if (section.cmEditor) {
        Riptide.Editor.destroy(section.cmEditor);
        section.cmEditor = null;
      }
      // Close editor popup if open
      if (section.popupEl) {
        section.popupEl.remove();
        section.popupEl = null;
        section.popupStatusEl = null;
      }
      Riptide.Modal.alert(
        'Playbook Deleted',
        `"${section.title}" was deleted by ${msg.user || 'another user'}.`
      );
    }

    // Clean up any lock indicator
    Riptide.Playbooks._clearEditLock(msg.noteId);

    clearTimeout(section.saveTimeout);
    section.el.remove();
    Riptide.Playbooks.sections.delete(msg.noteId);
    if (Riptide.Shortcuts && Riptide.Shortcuts._focusedSectionId === msg.noteId) {
      Riptide.Shortcuts._focusedSectionId = null;
    }
    Riptide.Variables.refresh();
  },

  _onNotesReordered(msg) {
    if (msg.tabId !== Riptide.Tabs.activeTabId) return;
    const stack = document.getElementById('playbook-stack');
    for (const noteId of msg.order) {
      const el = stack.querySelector(`.pb-section[data-note-id="${CSS.escape(noteId)}"]`);
      if (el) stack.appendChild(el);
    }
  },

  _onVariablesChanged(msg) {
    const tab = Riptide.Tabs.tabs.find(t => t.id === msg.tabId);
    if (tab) tab.variables = msg.variables;
    if (msg.tabId === Riptide.Tabs.activeTabId) {
      Riptide.Variables.refresh();
      Riptide.Preview.updateAllVariables();
    }
  },

  _onScopeChanged(msg) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (msg.tabId === tabId && Riptide.Scope) {
      Riptide.Scope.onScopeChanged(msg.scope);
    }
    // Also update the tab data in memory
    if (Riptide.Tabs) {
      const tab = Riptide.Tabs.tabs.find(t => t.id === msg.tabId);
      if (tab) tab.scope = msg.scope;
    }
  },

  _onNoteEditing(msg) {
    if (msg.tabId !== Riptide.Tabs.activeTabId) return;
    Riptide.Playbooks._showEditLock(msg.noteId, msg.nickname);
  },

  _onNoteEditDone(msg) {
    if (msg.tabId !== Riptide.Tabs.activeTabId) return;
    Riptide.Playbooks._clearEditLock(msg.noteId);
  },

  _onNoteLockDenied(msg) {
    if (msg.tabId !== Riptide.Tabs.activeTabId) return;
    Riptide.Playbooks._handleLockDenied(msg.noteId, msg.lockedBy);
  },

  _onEditLocks(msg) {
    const currentTabId = Riptide.Tabs.activeTabId;
    for (const lock of msg.locks) {
      if (lock.tabId === currentTabId) {
        Riptide.Playbooks._showEditLock(lock.noteId, lock.nickname);
      }
    }
  },

  _onRoomRenamed(msg) {
    Riptide.Auth.roomName = msg.name;
    Riptide.App._updateRoomInfo();
  },

  _onRoomDeleted() {
    Riptide.Sync.disconnect();
    Riptide.Auth.token = null;
    Riptide.Auth.roomId = null;
    Riptide.Auth.roomName = null;
    Riptide.Auth.nickname = null;
    sessionStorage.removeItem('cw_token');
    Riptide.Modal.alert('Room Deleted', 'This room has been deleted.').then(() => {
      location.reload();
    });
  },

  async _refreshState() {
    try {
      await Riptide.Tabs.load();
      Riptide.App._renderTabBar();

      // Init terminals for new tabs, destroy for removed ones
      for (const tab of Riptide.Tabs.tabs) {
        Riptide.Terminal.initTab(tab.id);
      }
      for (const tabId of [...Riptide.Terminal.instances.keys()]) {
        if (!Riptide.Tabs.tabs.find(t => t.id === tabId)) {
          Riptide.Terminal.destroyTab(tabId);
        }
      }

      const tabId = Riptide.Tabs.activeTabId;

      // Load independent modules in parallel so one failure doesn't block others
      await Promise.allSettled([
        Riptide.Playbooks.loadStack(),
        tabId ? Riptide.ScratchPad.load(tabId) : Promise.resolve(),
        tabId ? Riptide.Credentials.load(tabId) : Promise.resolve(),
        tabId && Riptide.History ? Riptide.History.load(tabId) : Promise.resolve(),
        tabId && Riptide.AuditLog ? Riptide.AuditLog.load(tabId) : Promise.resolve(),
        tabId && Riptide.Files ? Riptide.Files.load(tabId) : Promise.resolve(),
        Riptide.Knowledge ? Riptide.Knowledge.load() : Promise.resolve(),
        Riptide.Chat ? Riptide.Chat.load(tabId) : Promise.resolve()
      ]);

      Riptide.Variables.refresh();
    } catch (err) {
      console.error('State refresh after reconnect failed:', err);
    }
  },

  _onCommandLogged(msg) {
    if (msg.tabId !== Riptide.Tabs.activeTabId) return;
    Riptide.History.addEntry(msg.entry);
  },

  _onHistoryCleared(msg) {
    if (msg.tabId !== Riptide.Tabs.activeTabId) return;
    Riptide.History.clearAll();
  },

  _onAuditLogged(msg) {
    if (msg.tabId !== Riptide.Tabs.activeTabId) return;
    Riptide.AuditLog.addEntry(msg.entry);
  },

  _onAuditCleared(msg) {
    if (msg.tabId !== Riptide.Tabs.activeTabId) return;
    Riptide.AuditLog.clearAll();
  },

  _onScratchNoteCreated(msg) {
    // Show if scope is global OR if scope is tab and matches active tab
    if (msg.scope === Riptide.ScratchPad._scope) {
      if (msg.scope === 'global' || msg.tabId === Riptide.Tabs.activeTabId) {
        Riptide.ScratchPad.addEntry(msg.entry);
      }
    }
  },

  _onScratchNoteUpdated(msg) {
    if (msg.scope === Riptide.ScratchPad._scope) {
      if (msg.scope === 'global' || msg.tabId === Riptide.Tabs.activeTabId) {
        Riptide.ScratchPad.updateEntry(msg.entry);
      }
    }
  },

  _onScratchNoteDeleted(msg) {
    if (msg.scope === Riptide.ScratchPad._scope) {
      if (msg.scope === 'global' || msg.tabId === Riptide.Tabs.activeTabId) {
        Riptide.ScratchPad.removeEntry(msg.noteId);
      }
    }
  },

  _onScratchNoteSeverityChanged(msg) {
    if (msg.scope === Riptide.ScratchPad._scope) {
      if (msg.scope === 'global' || msg.tabId === Riptide.Tabs.activeTabId) {
        Riptide.ScratchPad.setSeverity(msg.noteId, msg.severity);
      }
    }
  },

  _onFindingFlagged(msg) {
    // Show prominent notification toast
    const el = document.createElement('div');
    el.className = 'finding-notification';

    const icon = document.createElement('span');
    icon.className = 'finding-notif-icon';
    icon.innerHTML = '&#9873;';

    const body = document.createElement('div');
    body.className = 'finding-notif-body';

    const header = document.createElement('div');
    header.className = 'finding-notif-header';
    header.textContent = (msg.nickname || 'Someone') + ' flagged a ' + (msg.context || 'finding');

    const title = document.createElement('div');
    title.className = 'finding-notif-title';
    title.textContent = msg.title || '';

    const preview = document.createElement('div');
    preview.className = 'finding-notif-preview';
    preview.textContent = msg.preview || '';

    body.appendChild(header);
    if (msg.title) body.appendChild(title);
    if (msg.preview) body.appendChild(preview);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'finding-notif-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => el.remove());

    el.appendChild(icon);
    el.appendChild(body);
    el.appendChild(closeBtn);
    document.body.appendChild(el);

    // Animate in
    requestAnimationFrame(() => el.classList.add('finding-notif-visible'));

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      el.classList.remove('finding-notif-visible');
      const fallback = setTimeout(() => { if (el.parentNode) el.remove(); }, 500);
      el.addEventListener('transitionend', () => {
        clearTimeout(fallback);
        if (el.parentNode) el.remove();
      }, { once: true });
    }, 8000);

    // Browser notification for background tabs
    if (document.hidden && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('Riptide: Finding Flagged', {
          body: (msg.nickname || 'Someone') + ': ' + (msg.title || msg.preview || 'New finding'),
          icon: '/favicon.ico',
          tag: 'finding-' + Date.now()
        });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    }
  },

  _onSessionReset() {
    location.reload();
  }
};
