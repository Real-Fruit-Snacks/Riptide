window.Riptide = window.Riptide || {};

Riptide.Library = {
  async search(query, tag) {
    const parts = [];
    if (query) parts.push('q=' + encodeURIComponent(query));
    if (tag) parts.push('tag=' + encodeURIComponent(tag));
    const params = parts.length > 0 ? '?' + parts.join('&') : '';
    return await Riptide.api(`/api/playbooks${params}`);
  },

  async browse(query, tags, category) {
    const parts = [];
    if (query) parts.push('q=' + encodeURIComponent(query));
    if (tags && tags.length) parts.push('tags=' + encodeURIComponent(tags.join(',')));
    if (category) parts.push('category=' + encodeURIComponent(category));
    const params = parts.length ? '?' + parts.join('&') : '';
    return await Riptide.api('/api/playbooks' + params);
  },

  async categories() {
    return await Riptide.api('/api/playbooks/categories');
  },

  async get(playbookId) {
    return await Riptide.api(`/api/playbooks/${encodeURIComponent(playbookId)}`);
  },

  async tags() {
    return await Riptide.api('/api/playbooks/tags');
  }
};
