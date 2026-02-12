window.Riptide = window.Riptide || {};

Riptide.Chat = {
  _panel: null,
  _scopeToggle: null,
  _scope: 'global',
  _inputArea: null,
  _input: null,
  messages: [],
  _unreadCount: 0,
  _newMsgIndicator: null,
  _activityDot: null,
  _tabUnreadMap: {},

  // Consistent user colors (Catppuccin palette)
  _userColors: [
    '#8aadf4', '#a6da95', '#f5a97f', '#ee99a0', '#c6a0f6',
    '#eed49f', '#f0c6c6', '#91d7e3', '#f4dbd6', '#b7bdf8'
  ],
  _userColorMap: {},

  init() {
    this._panel = Riptide.CollapsiblePanel.create({
      sectionId: 'chat-section',
      listId: 'chat-list',
      headerId: 'chat-header',
      chevronClass: 'chat-chevron',
      badgeClass: 'chat-badge',
      label: 'Chat',
      startExpanded: true,
      onToggle: (expanded) => {
        if (expanded) {
          this._unreadCount = 0;
          this._updateBadge();
          this._scrollToBottom();
        }
      }
    });

    // Scope toggle pill — insert before badge
    this._scopeToggle = document.createElement('span');
    this._scopeToggle.className = 'chat-scope-toggle';

    const globalBtn = document.createElement('button');
    globalBtn.className = 'chat-scope-btn active';
    globalBtn.textContent = 'Global';
    globalBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._switchScope('global');
    });

    const tabBtn = document.createElement('button');
    tabBtn.className = 'chat-scope-btn';
    tabBtn.textContent = 'Tab';
    tabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._switchScope('tab');
    });

    this._scopeToggle.appendChild(globalBtn);
    this._scopeToggle.appendChild(tabBtn);
    this._panel.header.insertBefore(this._scopeToggle, this._panel.badge);

    // Input area — appended to section after the list
    this._inputArea = document.createElement('div');
    this._inputArea.className = 'chat-input-area';

    this._input = document.createElement('input');
    this._input.type = 'text';
    this._input.className = 'chat-input';
    this._input.placeholder = 'Message...';
    this._input.maxLength = 5000;
    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendFromInput();
      }
    });

    const sendBtn = document.createElement('button');
    sendBtn.className = 'chat-send-btn';
    sendBtn.innerHTML = '&#10148;';
    sendBtn.title = 'Send message';
    sendBtn.addEventListener('click', () => this._sendFromInput());

    this._inputArea.appendChild(this._input);
    this._inputArea.appendChild(sendBtn);

    // "New messages" indicator
    this._newMsgIndicator = document.createElement('div');
    this._newMsgIndicator.className = 'chat-new-msg-indicator hidden';
    this._newMsgIndicator.textContent = 'New messages \u2193';
    this._newMsgIndicator.addEventListener('click', () => {
      this._scrollToBottom(true);
      this._hideNewMsgIndicator();
    });

    const section = document.getElementById('chat-section');
    section.appendChild(this._newMsgIndicator);
    section.appendChild(this._inputArea);

    // Hide indicator when user scrolls to bottom
    this._panel.list.addEventListener('scroll', () => {
      if (this._isAtBottom()) {
        this._hideNewMsgIndicator();
      }
    });

    // Activity tab notification dot
    const activityTab = document.querySelector('.panel-tab[data-panel="activity"]');
    if (activityTab) {
      activityTab.style.position = 'relative';
      this._activityDot = document.createElement('span');
      this._activityDot.className = 'chat-activity-dot hidden';
      activityTab.appendChild(this._activityDot);
    }
  },

  async load(tabId) {
    try {
      const params = new URLSearchParams({ scope: this._scope });
      if (tabId) params.set('tabId', tabId);
      this.messages = await Riptide.api(`/api/chat?${params}`);
    } catch {
      this.messages = [];
    }
    this._unreadCount = 0;
    this._render();
  },

  _sendFromInput() {
    const text = this._input.value.trim();
    if (!text) return;
    this._input.value = '';
    this.sendMessage(text);
  },

  async sendMessage(text) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    try {
      const data = await Riptide.api('/api/chat', {
        method: 'POST',
        body: { scope: this._scope, tabId, text }
      });
      this.messages.push(data.entry);
      this._render();
      this._scrollToBottom();
    } catch {
      Riptide.toast('Failed to send message');
    }
  },

  addMessage(entry, scope) {
    const wasAtBottom = this._isAtBottom();
    this.messages.push(entry);
    if (!this._panel.expanded) {
      this._unreadCount++;
    }
    this._render();
    if (wasAtBottom) {
      this._scrollToBottom(true);
    } else {
      this._showNewMsgIndicator();
    }
    // Notify if Activity tab is not visible
    if (!this._isActivityVisible()) {
      this._showActivityDot();
      this._showChatToast(entry, scope || this._scope);
    }
  },

  trackTabUnread(tabId) {
    this._tabUnreadMap[tabId] = true;
  },

  checkTabUnreads(tabId) {
    if (this._tabUnreadMap[tabId]) {
      delete this._tabUnreadMap[tabId];
      this._showActivityDot();
    }
  },

  async _switchScope(newScope) {
    this._scope = newScope;
    const btns = this._scopeToggle.querySelectorAll('.chat-scope-btn');
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

  _getUserColor(username) {
    if (!username) return this._userColors[0];
    if (this._userColorMap[username]) return this._userColorMap[username];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = ((hash << 5) - hash + username.charCodeAt(i)) | 0;
    }
    const color = this._userColors[Math.abs(hash) % this._userColors.length];
    this._userColorMap[username] = color;
    return color;
  },

  _isSameGroup(prev, curr) {
    if (!prev || !curr) return false;
    if (prev.user !== curr.user) return false;
    // Group messages within 2 minutes of each other
    const prevTime = new Date(prev.timestamp).getTime();
    const currTime = new Date(curr.timestamp).getTime();
    return (currTime - prevTime) < 120000;
  },

  _render() {
    const list = this._panel.list;
    list.innerHTML = '';
    this._updateBadge();

    if (this.messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty';
      empty.textContent = 'No messages yet';
      list.appendChild(empty);
      return;
    }

    const currentUser = Riptide.Auth ? Riptide.Auth.nickname : null;

    // Build groups of consecutive same-user messages within time window
    const groups = [];
    for (const msg of this.messages) {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && this._isSameGroup(lastGroup[lastGroup.length - 1], msg)) {
        lastGroup.push(msg);
      } else {
        groups.push([msg]);
      }
    }

    for (const group of groups) {
      const firstMsg = group[0];
      const isSelf = firstMsg.user === currentUser;
      const color = this._getUserColor(firstMsg.user);

      const wrapper = document.createElement('div');
      wrapper.className = 'chat-group ' + (isSelf ? 'chat-group-self' : 'chat-group-other');
      wrapper.style.borderColor = color;

      // Header with username + time
      const header = document.createElement('div');
      header.className = 'chat-msg-header';

      const user = document.createElement('span');
      user.className = 'chat-msg-user';
      user.textContent = firstMsg.user || '';
      user.style.color = color;

      const time = document.createElement('span');
      time.className = 'chat-msg-time';
      const d = new Date(firstMsg.timestamp);
      time.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      header.appendChild(user);
      header.appendChild(time);
      wrapper.appendChild(header);

      // All message texts in the group
      for (const msg of group) {
        const textEl = document.createElement('div');
        textEl.className = 'chat-msg-text';
        textEl.textContent = msg.text;
        wrapper.appendChild(textEl);
      }

      list.appendChild(wrapper);
    }
  },

  _updateBadge() {
    if (this._unreadCount > 0 && !this._panel.expanded) {
      this._panel.badge.textContent = this._unreadCount;
      this._panel.badge.classList.add('chat-badge-unread');
    } else {
      this._panel.badge.textContent = this.messages.length > 0 ? this.messages.length : '';
      this._panel.badge.classList.remove('chat-badge-unread');
    }
  },

  _isAtBottom() {
    const list = this._panel.list;
    // Consider "at bottom" if within 40px of the end
    return list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  },

  _scrollToBottom(force) {
    if (!force && !this._isAtBottom()) return;
    const list = this._panel.list;
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  },

  _showNewMsgIndicator() {
    if (this._newMsgIndicator) {
      this._newMsgIndicator.classList.remove('hidden');
    }
  },

  _hideNewMsgIndicator() {
    if (this._newMsgIndicator) {
      this._newMsgIndicator.classList.add('hidden');
    }
  },

  _isActivityVisible() {
    const group = document.getElementById('panel-group-activity');
    return group && !group.classList.contains('hidden');
  },

  _showActivityDot() {
    if (this._activityDot) {
      this._activityDot.classList.remove('hidden');
    }
  },

  hideActivityDot() {
    if (this._activityDot) {
      this._activityDot.classList.add('hidden');
    }
  },

  _showChatToast(entry, scope) {
    const preview = entry.text.length > 50 ? entry.text.slice(0, 50) + '\u2026' : entry.text;
    const el = document.createElement('div');
    el.className = 'chat-toast';

    const scopeLabel = document.createElement('span');
    scopeLabel.className = 'chat-toast-scope';
    scopeLabel.textContent = scope === 'tab' ? 'Tab' : 'Global';
    el.appendChild(scopeLabel);

    const strong = document.createElement('strong');
    strong.textContent = entry.user;
    el.appendChild(strong);
    el.appendChild(document.createTextNode(': ' + preview));

    el.addEventListener('click', () => {
      const tab = document.querySelector('.panel-tab[data-panel="activity"]');
      if (tab) tab.click();
      if (el.parentNode) el.remove();
    });

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('chat-toast-visible'));
    setTimeout(() => {
      el.classList.remove('chat-toast-visible');
      const fallback = setTimeout(() => { if (el.parentNode) el.remove(); }, 500);
      el.addEventListener('transitionend', () => {
        clearTimeout(fallback);
        if (el.parentNode) el.remove();
      }, { once: true });
    }, 3500);
  }
};
