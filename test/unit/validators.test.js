'use strict';

const helpers = require('../../lib/helpers');

function mockReqRes(body) {
  const req = { body };
  const res = {
    _status: null,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; return this; }
  };
  return { req, res };
}

describe('validateCredentialFields', () => {
  it('returns fields object for valid input', () => {
    const { req, res } = mockReqRes({ username: 'admin', password: 'pass123' });
    const result = helpers.validateCredentialFields(req, res);
    expect(result).toEqual({
      service: '',
      username: 'admin',
      password: 'pass123',
      hash: '',
      notes: ''
    });
  });

  it('returns null and 400 when requireAtLeastOne and all empty', () => {
    const { req, res } = mockReqRes({});
    const result = helpers.validateCredentialFields(req, res, { requireAtLeastOne: true });
    expect(result).toBeNull();
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: 'At least one field is required' });
  });

  it('rejects field over maxFieldLength', () => {
    const { req, res } = mockReqRes({ username: 'a'.repeat(2001) });
    const result = helpers.validateCredentialFields(req, res);
    expect(result).toBeNull();
    expect(res._status).toBe(400);
    expect(res._json.error).toContain('2000 characters');
  });

  it('accepts field at exactly maxFieldLength', () => {
    const { req, res } = mockReqRes({ username: 'a'.repeat(2000) });
    const result = helpers.validateCredentialFields(req, res);
    expect(result).not.toBeNull();
    expect(result.username).toBe('a'.repeat(2000));
  });

  it('rejects non-string fields', () => {
    const { req, res } = mockReqRes({ username: 123 });
    const result = helpers.validateCredentialFields(req, res);
    expect(result).toBeNull();
    expect(res._status).toBe(400);
  });

  it('allows custom maxFieldLength', () => {
    const { req, res } = mockReqRes({ username: 'a'.repeat(51) });
    const result = helpers.validateCredentialFields(req, res, { maxFieldLength: 50 });
    expect(result).toBeNull();
    expect(res._status).toBe(400);
    expect(res._json.error).toContain('50 characters');
  });

  it('defaults missing fields to empty string', () => {
    const { req, res } = mockReqRes({ service: 'ssh' });
    const result = helpers.validateCredentialFields(req, res);
    expect(result.username).toBe('');
    expect(result.password).toBe('');
    expect(result.hash).toBe('');
    expect(result.notes).toBe('');
  });

  it('accepts all valid fields', () => {
    const { req, res } = mockReqRes({
      service: 'ftp',
      username: 'user1',
      password: 'pass1',
      hash: 'abc123',
      notes: 'test notes'
    });
    const result = helpers.validateCredentialFields(req, res);
    expect(result).toEqual({
      service: 'ftp',
      username: 'user1',
      password: 'pass1',
      hash: 'abc123',
      notes: 'test notes'
    });
  });

  it('passes when requireAtLeastOne and at least one field present', () => {
    const { req, res } = mockReqRes({ notes: 'something' });
    const result = helpers.validateCredentialFields(req, res, { requireAtLeastOne: true });
    expect(result).not.toBeNull();
    expect(result.notes).toBe('something');
  });

  it('rejects array instead of string', () => {
    const { req, res } = mockReqRes({ username: ['admin'] });
    const result = helpers.validateCredentialFields(req, res);
    expect(result).toBeNull();
    expect(res._status).toBe(400);
  });

  it('rejects object instead of string', () => {
    const { req, res } = mockReqRes({ username: { name: 'admin' } });
    const result = helpers.validateCredentialFields(req, res);
    expect(result).toBeNull();
    expect(res._status).toBe(400);
  });

  it('treats null as falsy and defaults to empty string', () => {
    // null is filtered out by .filter(Boolean), so it's treated as missing
    const { req, res } = mockReqRes({ username: null });
    const result = helpers.validateCredentialFields(req, res);
    expect(result).not.toBeNull();
    expect(result.username).toBe('');
  });

  it('accepts empty strings', () => {
    const { req, res } = mockReqRes({
      service: '',
      username: '',
      password: '',
      hash: '',
      notes: ''
    });
    const result = helpers.validateCredentialFields(req, res);
    expect(result).toEqual({
      service: '',
      username: '',
      password: '',
      hash: '',
      notes: ''
    });
  });

  it('rejects when multiple fields over limit', () => {
    const { req, res } = mockReqRes({
      username: 'a'.repeat(2001),
      password: 'b'.repeat(2001)
    });
    const result = helpers.validateCredentialFields(req, res);
    expect(result).toBeNull();
    expect(res._status).toBe(400);
  });

  it('handles custom maxFieldLength with requireAtLeastOne', () => {
    const { req, res } = mockReqRes({ username: 'a'.repeat(51) });
    const result = helpers.validateCredentialFields(req, res, {
      requireAtLeastOne: true,
      maxFieldLength: 50
    });
    expect(result).toBeNull();
    expect(res._status).toBe(400);
  });
});
