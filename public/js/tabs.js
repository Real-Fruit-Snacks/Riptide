window.Riptide = window.Riptide || {};

Riptide.Tabs = {
  tabs: [],
  activeTabId: null,

  async load() {
    const data = await Riptide.api('/api/tabs');
    this.tabs = data.tabs;

    // Use per-session activeTabId from sessionStorage instead of shared room state
    const storedTabId = sessionStorage.getItem('cw_activeTabId');
    if (storedTabId && data.tabs.find(t => t.id === storedTabId)) {
      this.activeTabId = storedTabId;
    } else {
      this.activeTabId = data.tabs[0]?.id || null;
    }

    return data;
  },

  async create(name) {
    const tab = await Riptide.api('/api/tabs', {
      method: 'POST',
      body: { name }
    });
    this.tabs.push(tab);
    return tab;
  },

  async remove(tabId) {
    await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}`, {
      method: 'DELETE'
    });
    this.tabs = this.tabs.filter(t => t.id !== tabId);
    if (this.activeTabId === tabId && this.tabs.length > 0) {
      this.activeTabId = this.tabs[0].id;
    }
  },

  async rename(tabId, name) {
    await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}`, {
      method: 'PATCH',
      body: { name }
    });
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) tab.name = name;
  },

  async setActiveTab(tabId) {
    // Per-session activeTabId - no server sync needed
    this.activeTabId = tabId;
    sessionStorage.setItem('cw_activeTabId', tabId);
  },

  async setActiveNote(tabId, noteId) {
    await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}`, {
      method: 'PATCH',
      body: { activeNoteId: noteId }
    });
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) tab.activeNoteId = noteId;
  },

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId) || this.tabs[0];
  },

  getTabVariables(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    return (tab && tab.variables) ? { ...tab.variables } : {};
  },

  async setTabVariables(tabId, variables) {
    await Riptide.api(`/api/tabs/${encodeURIComponent(tabId)}`, {
      method: 'PATCH',
      body: { variables }
    });
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) tab.variables = variables;
  }
};
