window.Riptide = window.Riptide || {};

Riptide.Presence = {
  users: [],   // [{ nickname, activeTabId }]
  _container: null,

  init() {
    this._container = document.getElementById('presence-bar');
  },

  update(users) {
    this.users = users.map(u => typeof u === 'string' ? { nickname: u, activeTabId: null } : u);
    this._render();
    this._renderTabDots();
  },

  addUser(data) {
    const nickname = typeof data === 'string' ? data : data.nickname;
    const activeTabId = (typeof data === 'object' && data.activeTabId) || null;
    if (!this.users.find(u => u.nickname === nickname)) {
      this.users.push({ nickname, activeTabId });
    }
    this._render();
    this._renderTabDots();
  },

  removeUser(nickname) {
    this.users = this.users.filter(u => u.nickname !== nickname);
    this._render();
    this._renderTabDots();
  },

  setUserTab(nickname, tabId) {
    const user = this.users.find(u => u.nickname === nickname);
    if (user) {
      user.activeTabId = tabId;
    }
    this._renderTabDots();
  },

  getUsersOnTab(tabId) {
    return this.users.filter(u => u.activeTabId === tabId && u.nickname !== Riptide.Auth.nickname);
  },

  _render() {
    if (!this._container) return;
    this._container.innerHTML = '';

    for (const user of this.users) {
      const avatar = document.createElement('span');
      avatar.className = 'presence-avatar';
      avatar.textContent = user.nickname.charAt(0).toUpperCase();
      avatar.title = user.nickname;
      avatar.style.backgroundColor = this._colorFor(user.nickname);
      this._container.appendChild(avatar);
    }
  },

  _renderTabDots() {
    // Remove existing dots
    document.querySelectorAll('.tab-presence-dots').forEach(el => el.remove());

    const tabItems = document.querySelectorAll('.tab-item');
    for (const tabEl of tabItems) {
      const tabId = tabEl.dataset.tabId;
      if (!tabId) continue;

      const others = this.getUsersOnTab(tabId);
      if (others.length === 0) continue;

      const dotsContainer = document.createElement('span');
      dotsContainer.className = 'tab-presence-dots';

      for (const user of others) {
        const dot = document.createElement('span');
        dot.className = 'tab-presence-dot';
        dot.style.backgroundColor = this._colorFor(user.nickname);
        dot.title = user.nickname;
        dotsContainer.appendChild(dot);
      }

      // Insert after tab-name, before tab-close
      const nameSpan = tabEl.querySelector('.tab-name');
      if (nameSpan) {
        nameSpan.after(dotsContainer);
      }
    }
  },

  _colorFor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = Riptide.Theme
      ? ['red', 'peach', 'yellow', 'green', 'teal', 'blue', 'mauve', 'pink'].map(t => Riptide.Theme.getColor(t))
      : ['#ed8796', '#f5a97f', '#eed49f', '#a6da95', '#8bd5ca', '#8aadf4', '#c6a0f6', '#f5bde6'];
    return colors[Math.abs(hash) % colors.length];
  }
};
