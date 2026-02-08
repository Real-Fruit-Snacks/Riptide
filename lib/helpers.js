'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const scryptAsync = promisify(crypto.scrypt);

// --- Password Hashing ---
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64, { N: 32768, r: 8, p: 2, maxmem: 64 * 1024 * 1024 })).toString('hex');
  return salt + ':' + hash;
}

async function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const test = (await scryptAsync(password, salt, 64, { N: 32768, r: 8, p: 2, maxmem: 64 * 1024 * 1024 })).toString('hex');
    const hashBuf = Buffer.from(hash, 'hex');
    const testBuf = Buffer.from(test, 'hex');
    if (hashBuf.length !== testBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, testBuf);
  } catch {
    return false;
  }
}

// --- Frontmatter Parser ---
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  const lines = match[1].split('\n');
  let currentKey = null;

  for (const line of lines) {
    if (!line.includes(':')) continue;
    // Inline array: tags: [a, b, c]
    const kvMatch = line.match(/^(\w+):\s*\[(.*)]\s*$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      meta[currentKey] = kvMatch[2].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    // Scalar key: tags:
    const keyOnly = line.match(/^(\w+):\s*$/);
    if (keyOnly) {
      currentKey = keyOnly[1];
      meta[currentKey] = [];
      continue;
    }
    // List item: - value
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(listMatch[1].trim().replace(/^['"]|['"]$/g, ''));
    }
  }

  return { meta, body: match[2] };
}

// --- Token Hashing ---
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// --- Credential Validation ---
function validateCredentialFields(req, res, { requireAtLeastOne = false, maxFieldLength = 2000 } = {}) {
  const { service, username, password, hash, notes } = req.body;
  if (requireAtLeastOne) {
    if (!service && !username && !password && !hash && !notes) {
      res.status(400).json({ error: 'At least one field is required' });
      return null;
    }
  }
  const fields = [service, username, password, hash, notes].filter(Boolean);
  if (fields.some(f => typeof f !== 'string' || f.length > maxFieldLength)) {
    res.status(400).json({ error: `Credential fields must be strings under ${maxFieldLength} characters` });
    return null;
  }
  return { service: service || '', username: username || '', password: password || '', hash: hash || '', notes: notes || '' };
}

module.exports = {
  hashPassword,
  verifyPassword,
  parseFrontmatter,
  hashToken,
  validateCredentialFields
};
