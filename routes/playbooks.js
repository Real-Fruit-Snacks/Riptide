'use strict';
const path = require('path');
const fsp = require('fs').promises;
const express = require('express');

// Tag-to-category inference map
const TAG_CATEGORY_MAP = {
  'recon': 'Reconnaissance', 'reconnaissance': 'Reconnaissance',
  'scanning': 'Reconnaissance', 'enumeration': 'Reconnaissance', 'osint': 'Reconnaissance',
  'exploit': 'Exploitation', 'exploitation': 'Exploitation', 'cve': 'Exploitation',
  'post-exploit': 'Post-Exploitation', 'post-exploitation': 'Post-Exploitation',
  'persistence': 'Post-Exploitation', 'backdoor': 'Post-Exploitation',
  'privesc': 'Privilege Escalation', 'privilege-escalation': 'Privilege Escalation',
  'lateral': 'Lateral Movement', 'lateral-movement': 'Lateral Movement', 'pivoting': 'Lateral Movement',
  'web': 'Web Application', 'webapp': 'Web Application',
  'xss': 'Web Application', 'sqli': 'Web Application',
  'ad': 'Active Directory', 'active-directory': 'Active Directory', 'kerberos': 'Active Directory',
  'network': 'Networking', 'networking': 'Networking',
  'docker': 'Infrastructure', 'containers': 'Infrastructure', 'cloud': 'Infrastructure',
  'password': 'Credential Access', 'cracking': 'Credential Access', 'hash': 'Credential Access',
  'methodology': 'Methodology', 'checklist': 'Methodology',
  'system': 'System', 'linux': 'System', 'windows': 'System',
};

const CATEGORY_ORDER = [
  'Reconnaissance', 'Exploitation', 'Post-Exploitation',
  'Privilege Escalation', 'Lateral Movement', 'Web Application',
  'Active Directory', 'Networking', 'Infrastructure', 'Credential Access',
  'Methodology', 'System', 'Uncategorized'
];

function fuzzyScore(query, text) {
  if (!query || !text) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Exact substring match — highest score
  if (t.includes(q)) {
    const idx = t.indexOf(q);
    return 100 + (idx === 0 ? 20 : 0);
  }

  // Fuzzy: all query chars in order
  let qi = 0, score = 0, lastIdx = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10;
      if (lastIdx === ti - 1) score += 5;         // consecutive bonus
      if (ti === 0 || /[\s_-]/.test(t[ti - 1])) score += 3; // word boundary
      lastIdx = ti;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

module.exports = function(ctx) {
  const router = express.Router();
  const { storage, requireRoom, PLAYBOOKS_DIR, parseFrontmatter } = ctx;

  // --- Playbook index cache ---
  let playbookIndex = null;
  let playbookIndexExpiry = 0;
  const PLAYBOOK_INDEX_TTL = 30000; // 30 seconds

  async function getPlaybookIndex() {
    if (playbookIndex && Date.now() < playbookIndexExpiry) {
      return playbookIndex;
    }

    if (!await storage.fileExists(PLAYBOOKS_DIR)) {
      playbookIndex = [];
      playbookIndexExpiry = Date.now() + PLAYBOOK_INDEX_TTL;
      return playbookIndex;
    }

    const files = (await fsp.readdir(PLAYBOOKS_DIR)).filter(f => f.endsWith('.md'));
    playbookIndex = await Promise.all(files.map(async f => {
      const id = f.replace(/\.md$/, '');
      const filePath = path.join(PLAYBOOKS_DIR, f);
      const content = await fsp.readFile(filePath, 'utf-8');
      const stat = await fsp.stat(filePath);

      const { meta, body } = parseFrontmatter(content);
      const tags = Array.isArray(meta.tags) ? meta.tags : [];

      const h1Match = body.match(/^#\s+(.+)$/m);
      const title = h1Match ? h1Match[1].trim() : id;

      const bodyLines = body.split('\n');
      let description = '';
      for (const line of bodyLines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          description = trimmed.substring(0, 120);
          break;
        }
      }

      // Category: explicit frontmatter > inferred from tags > 'Uncategorized'
      let category = (meta.category || '').trim();
      if (!category) {
        for (const t of tags) {
          if (TAG_CATEGORY_MAP[t.toLowerCase()]) {
            category = TAG_CATEGORY_MAP[t.toLowerCase()];
            break;
          }
        }
      }
      if (!category) category = 'Uncategorized';

      return { id, title, description, tags, category, modified: stat.mtime.toISOString() };
    }));

    playbookIndexExpiry = Date.now() + PLAYBOOK_INDEX_TTL;
    return playbookIndex;
  }

  router.get('/playbooks', requireRoom, async (req, res) => {
    try {
      const q = (req.query.q || '').toLowerCase().trim();
      // Support both old `tag` (single) and new `tags` (multi, comma-separated) params
      const tagParam = req.query.tags || req.query.tag || '';
      const tagFilters = tagParam.split(',').map(t => t.toLowerCase().trim()).filter(Boolean);
      const catFilter = (req.query.category || '').trim();

      let results = await getPlaybookIndex();

      // Copy so filtering doesn't mutate cache
      results = [...results];

      // Multi-tag AND filter
      if (tagFilters.length > 0) {
        results = results.filter(r =>
          tagFilters.every(tf => r.tags.some(t => t.toLowerCase() === tf))
        );
      }

      // Category filter
      if (catFilter) {
        results = results.filter(r => r.category === catFilter);
      }

      // Fuzzy search with scoring
      if (q) {
        results = results
          .map(r => ({
            ...r,
            _score: Math.max(
              fuzzyScore(q, r.title) * 2,      // title matches weighted 2x
              fuzzyScore(q, r.description),
              fuzzyScore(q, r.id),
              r.tags.some(t => t.toLowerCase().includes(q)) ? 80 : 0
            )
          }))
          .filter(r => r._score > 0)
          .sort((a, b) => b._score - a._score);
      } else {
        results.sort((a, b) => a.title.localeCompare(b.title));
      }

      res.json(results);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/playbooks/tags', requireRoom, async (req, res) => {
    try {
      const index = await getPlaybookIndex();
      const tagSet = new Set();
      for (const entry of index) {
        for (const t of entry.tags) {
          tagSet.add(t.toLowerCase());
        }
      }
      res.json([...tagSet].sort());
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/playbooks/categories', requireRoom, async (req, res) => {
    try {
      const index = await getPlaybookIndex();
      const counts = {};
      for (const entry of index) {
        counts[entry.category] = (counts[entry.category] || 0) + 1;
      }
      // Return sorted with pentest phases first
      const result = CATEGORY_ORDER
        .filter(c => counts[c])
        .map(c => ({ name: c, count: counts[c] }));
      // Add any categories not in the predefined order
      for (const [name, count] of Object.entries(counts)) {
        if (!CATEGORY_ORDER.includes(name)) result.push({ name, count });
      }
      res.json(result);
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/playbooks/:id', requireRoom, async (req, res) => {
    try {
      const id = req.params.id;
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        return res.status(400).json({ error: 'Invalid playbook ID' });
      }

      const filePath = path.resolve(PLAYBOOKS_DIR, id + '.md');
      if (!filePath.startsWith(path.resolve(PLAYBOOKS_DIR))) {
        return res.status(400).json({ error: 'Invalid playbook path' });
      }

      if (!await storage.fileExists(filePath)) {
        return res.status(404).json({ error: 'Playbook not found' });
      }

      const content = await fsp.readFile(filePath, 'utf-8');
      const stat = await fsp.stat(filePath);

      const { meta, body } = parseFrontmatter(content);
      const tags = Array.isArray(meta.tags) ? meta.tags : [];

      const h1Match = body.match(/^#\s+(.+)$/m);
      const title = h1Match ? h1Match[1].trim() : id;

      // Resolve category same as index
      let category = (meta.category || '').trim();
      if (!category) {
        for (const t of tags) {
          if (TAG_CATEGORY_MAP[t.toLowerCase()]) {
            category = TAG_CATEGORY_MAP[t.toLowerCase()];
            break;
          }
        }
      }
      if (!category) category = 'Uncategorized';

      res.json({ id, title, content: body, tags, category, modified: stat.mtime.toISOString() });
    } catch (err) {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
