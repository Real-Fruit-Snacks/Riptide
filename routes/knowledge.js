'use strict';
const crypto = require('crypto');
const express = require('express');

const ALLOWED_TYPES = ['technique', 'service', 'tool', 'credential-pattern', 'finding', 'note'];

module.exports = function(ctx) {
  const router = express.Router();
  const { storage, requireRoom, broadcastToRoom } = ctx;

  // Validation helper
  function validateEntry(body, isUpdate = false) {
    const errors = [];

    // Title validation (required for create, optional for update)
    if (!isUpdate && !body.title) {
      errors.push('Title is required');
    }
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (title.length === 0 || title.length > 200) {
        errors.push('Title must be 1-200 characters');
      }
    }

    // Type validation
    if (body.type !== undefined) {
      if (!ALLOWED_TYPES.includes(body.type)) {
        errors.push(`Type must be one of: ${ALLOWED_TYPES.join(', ')}`);
      }
    } else if (!isUpdate) {
      errors.push('Type is required');
    }

    // Content validation
    if (body.content !== undefined && String(body.content).length > 5000) {
      errors.push('Content must be 5000 characters or less');
    }

    // Tags validation
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) {
        errors.push('Tags must be an array');
      } else if (body.tags.length > 20) {
        errors.push('Maximum 20 tags allowed');
      } else {
        for (const tag of body.tags) {
          const trimmed = String(tag).toLowerCase().trim();
          if (trimmed.length === 0 || trimmed.length > 50) {
            errors.push('Each tag must be 1-50 characters');
            break;
          }
        }
      }
    }

    // References validation
    if (body.references !== undefined) {
      if (!Array.isArray(body.references)) {
        errors.push('References must be an array');
      } else if (body.references.length > 10) {
        errors.push('Maximum 10 references allowed');
      } else {
        for (const ref of body.references) {
          if (String(ref).length > 500) {
            errors.push('Each reference must be 500 characters or less');
            break;
          }
        }
      }
    }

    return errors;
  }

  // Sanitize entry data
  function sanitizeEntry(body) {
    const sanitized = {};
    if (body.type !== undefined) sanitized.type = String(body.type).trim();
    if (body.title !== undefined) sanitized.title = String(body.title).trim();
    if (body.content !== undefined) sanitized.content = String(body.content).trim();
    if (body.sourceRoom !== undefined) sanitized.sourceRoom = String(body.sourceRoom).trim().substring(0, 200);
    if (body.sourceRoomId !== undefined) sanitized.sourceRoomId = String(body.sourceRoomId).trim().substring(0, 50);
    if (body.sourceTab !== undefined) sanitized.sourceTab = String(body.sourceTab).trim().substring(0, 200);
    if (body.addedBy !== undefined) sanitized.addedBy = String(body.addedBy).trim().substring(0, 50);

    if (body.tags !== undefined && Array.isArray(body.tags)) {
      sanitized.tags = body.tags.map(t => String(t).toLowerCase().trim()).filter(t => t.length > 0);
    }

    if (body.references !== undefined && Array.isArray(body.references)) {
      sanitized.references = body.references.map(r => String(r).trim()).filter(r => r.length > 0);
    }

    return sanitized;
  }

  // Update tag counts helper
  function updateTagCounts(tags, oldTags, newTags) {
    // Decrement old tags
    if (oldTags) {
      for (const tag of oldTags) {
        if (tags[tag]) {
          tags[tag]--;
          if (tags[tag] <= 0) delete tags[tag];
        }
      }
    }

    // Increment new tags
    if (newTags) {
      for (const tag of newTags) {
        tags[tag] = (tags[tag] || 0) + 1;
      }
    }
  }

  // Full-text search helper
  function matchesSearch(entry, q, tag, type) {
    // Type filter
    if (type && entry.type !== type) return false;

    // Tag filter
    if (tag && (!entry.tags || !entry.tags.includes(tag))) return false;

    // Text search
    if (q) {
      const lowerQ = q.toLowerCase();
      const searchableText = [
        entry.title,
        entry.content,
        entry.tags ? entry.tags.join(' ') : '',
        entry.references ? entry.references.join(' ') : '',
        entry.sourceRoom,
        entry.sourceTab
      ].filter(Boolean).join(' ').toLowerCase();

      if (!searchableText.includes(lowerQ)) return false;
    }

    return true;
  }

  // GET /api/knowledge — List/search entries
  router.get('/knowledge', async (req, res) => {
    try {
      const { q, tag, type } = req.query;
      const data = await storage.readKnowledge();

      let filtered = data.entries;

      // Apply filters
      if (q || tag || type) {
        filtered = filtered.filter(entry => matchesSearch(entry, q, tag, type));
      }

      // Sort by timestamp descending (newest first)
      filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      res.json({ entries: filtered, total: filtered.length });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/knowledge/tags — All tags with counts
  router.get('/knowledge/tags', async (req, res) => {
    try {
      const data = await storage.readKnowledge();
      res.json({ tags: data.tags || {} });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/knowledge/:id — Single entry
  router.get('/knowledge/:id', async (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[a-f0-9]{8,16}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid entry ID' });
      }

      const data = await storage.readKnowledge();
      const entry = data.entries.find(e => e.id === id);

      if (!entry) {
        return res.status(404).json({ error: 'Entry not found' });
      }

      res.json({ entry });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/knowledge — Create entry
  router.post('/knowledge', requireRoom, async (req, res) => {
    try {
      const errors = validateEntry(req.body, false);
      if (errors.length > 0) {
        return res.status(400).json({ error: errors.join(', ') });
      }

      const sanitized = sanitizeEntry(req.body);

      const entry = {
        id: crypto.randomBytes(8).toString('hex'),
        type: sanitized.type,
        title: sanitized.title,
        content: sanitized.content || '',
        tags: sanitized.tags || [],
        sourceRoom: sanitized.sourceRoom || '',
        sourceRoomId: sanitized.sourceRoomId || '',
        sourceTab: sanitized.sourceTab || '',
        addedBy: sanitized.addedBy || '',
        timestamp: new Date().toISOString(),
        references: sanitized.references || []
      };

      await storage.atomicUpdateKnowledge((data) => {
        data.entries.push(entry);
        updateTagCounts(data.tags, null, entry.tags);
        return entry;
      });

      res.json({ ok: true, entry });

      broadcastToRoom(req.roomId, { type: 'knowledge-created', entry }, req.token);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/knowledge/:id — Update entry
  router.put('/knowledge/:id', requireRoom, async (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[a-f0-9]{8,16}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid entry ID' });
      }

      const errors = validateEntry(req.body, true);
      if (errors.length > 0) {
        return res.status(400).json({ error: errors.join(', ') });
      }

      const sanitized = sanitizeEntry(req.body);

      const result = await storage.atomicUpdateKnowledge((data) => {
        const entry = data.entries.find(e => e.id === id);
        if (!entry) return false;

        const oldTags = entry.tags;

        // Update fields
        if (sanitized.type !== undefined) entry.type = sanitized.type;
        if (sanitized.title !== undefined) entry.title = sanitized.title;
        if (sanitized.content !== undefined) entry.content = sanitized.content;
        if (sanitized.sourceRoom !== undefined) entry.sourceRoom = sanitized.sourceRoom;
        if (sanitized.sourceRoomId !== undefined) entry.sourceRoomId = sanitized.sourceRoomId;
        if (sanitized.sourceTab !== undefined) entry.sourceTab = sanitized.sourceTab;
        if (sanitized.addedBy !== undefined) entry.addedBy = sanitized.addedBy;
        if (sanitized.references !== undefined) entry.references = sanitized.references;
        if (sanitized.tags !== undefined) {
          entry.tags = sanitized.tags;
          updateTagCounts(data.tags, oldTags, entry.tags);
        }

        entry.timestamp = new Date().toISOString();

        return entry;
      });

      if (result === false) {
        return res.status(404).json({ error: 'Entry not found' });
      }

      res.json({ ok: true, entry: result });

      broadcastToRoom(req.roomId, { type: 'knowledge-updated', entry: result }, req.token);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/knowledge/:id — Delete entry
  router.delete('/knowledge/:id', requireRoom, async (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[a-f0-9]{8,16}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid entry ID' });
      }

      const result = await storage.atomicUpdateKnowledge((data) => {
        const index = data.entries.findIndex(e => e.id === id);
        if (index === -1) return false;

        const entry = data.entries[index];
        updateTagCounts(data.tags, entry.tags, null);
        data.entries.splice(index, 1);

        return true;
      });

      if (result === false) {
        return res.status(404).json({ error: 'Entry not found' });
      }

      res.json({ ok: true });

      broadcastToRoom(req.roomId, { type: 'knowledge-deleted', entryId: id }, req.token);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
