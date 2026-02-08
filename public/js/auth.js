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
  }
};
