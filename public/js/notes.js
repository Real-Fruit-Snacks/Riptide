window.Riptide = window.Riptide || {};

Riptide.Notes = {
  currentNoteId: null,

  _baseUrl(tabId) {
    return `/api/tabs/${encodeURIComponent(tabId)}/notes`;
  },

  async list(tabId) {
    return await Riptide.api(this._baseUrl(tabId));
  },

  async load(tabId, noteId) {
    const data = await Riptide.api(`${this._baseUrl(tabId)}/${encodeURIComponent(noteId)}`);
    this.currentNoteId = noteId;
    return data;
  },

  async save(tabId, noteId, content) {
    return await Riptide.api(`${this._baseUrl(tabId)}/${encodeURIComponent(noteId)}`, {
      method: 'PUT',
      body: { content }
    });
  },

  async create(tabId, title, content) {
    const body = { title };
    if (content !== undefined) {
      body.content = content;
    }
    return await Riptide.api(this._baseUrl(tabId), {
      method: 'POST',
      body
    });
  },

  async remove(tabId, noteId) {
    await Riptide.api(`${this._baseUrl(tabId)}/${encodeURIComponent(noteId)}`, {
      method: 'DELETE'
    });
    this.currentNoteId = null;
  }
};
