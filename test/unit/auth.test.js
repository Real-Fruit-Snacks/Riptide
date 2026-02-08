'use strict';

const helpers = require('../../lib/helpers');

describe('hashPassword', () => {
  it('returns salt:hash format', async () => {
    const result = await helpers.hashPassword('test123');
    expect(result).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  });

  it('produces different salts each call', async () => {
    const a = await helpers.hashPassword('test123');
    const b = await helpers.hashPassword('test123');
    expect(a.split(':')[0]).not.toBe(b.split(':')[0]);
  });

  it('salt is 32 hex chars', async () => {
    const result = await helpers.hashPassword('mypass');
    const salt = result.split(':')[0];
    expect(salt).toHaveLength(32);
    expect(salt).toMatch(/^[a-f0-9]+$/);
  });

  it('hash is 128 hex chars', async () => {
    const result = await helpers.hashPassword('mypass');
    const hash = result.split(':')[1];
    expect(hash).toHaveLength(128);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('handles empty password', async () => {
    const result = await helpers.hashPassword('');
    expect(result).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  });

  it('handles very long password', async () => {
    const longPass = 'a'.repeat(10000);
    const result = await helpers.hashPassword(longPass);
    expect(result).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  });

  it('handles special characters', async () => {
    const result = await helpers.hashPassword('p@$$w0rd!#%^&*()');
    expect(result).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  });
});

describe('verifyPassword', () => {
  it('verifies correct password', async () => {
    const stored = await helpers.hashPassword('mypass');
    expect(await helpers.verifyPassword('mypass', stored)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const stored = await helpers.hashPassword('mypass');
    expect(await helpers.verifyPassword('wrong', stored)).toBe(false);
  });

  it('returns false for malformed stored value', async () => {
    expect(await helpers.verifyPassword('test', 'not-a-hash')).toBe(false);
  });

  it('returns false for empty stored value', async () => {
    expect(await helpers.verifyPassword('test', '')).toBe(false);
  });

  it('returns false for stored value with only salt', async () => {
    expect(await helpers.verifyPassword('test', 'abcd1234:')).toBe(false);
  });

  it('returns false for stored value with only hash', async () => {
    expect(await helpers.verifyPassword('test', ':abcd1234')).toBe(false);
  });

  it('returns false for stored value with no colon', async () => {
    expect(await helpers.verifyPassword('test', 'abcd1234')).toBe(false);
  });

  it('verifies empty password when originally hashed as empty', async () => {
    const stored = await helpers.hashPassword('');
    expect(await helpers.verifyPassword('', stored)).toBe(true);
  });

  it('rejects empty password against non-empty hash', async () => {
    const stored = await helpers.hashPassword('mypass');
    expect(await helpers.verifyPassword('', stored)).toBe(false);
  });

  it('handles special characters correctly', async () => {
    const pass = 'p@$$w0rd!#%^&*()';
    const stored = await helpers.hashPassword(pass);
    expect(await helpers.verifyPassword(pass, stored)).toBe(true);
  });

  it('is case sensitive', async () => {
    const stored = await helpers.hashPassword('MyPass');
    expect(await helpers.verifyPassword('mypass', stored)).toBe(false);
  });

  it('detects single character difference', async () => {
    const stored = await helpers.hashPassword('password123');
    expect(await helpers.verifyPassword('password124', stored)).toBe(false);
  });

  it('handles very long passwords', async () => {
    const longPass = 'a'.repeat(10000);
    const stored = await helpers.hashPassword(longPass);
    expect(await helpers.verifyPassword(longPass, stored)).toBe(true);
    expect(await helpers.verifyPassword(longPass + 'b', stored)).toBe(false);
  });
});
