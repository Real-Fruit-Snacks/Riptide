// test/unit/severity.test.js

// Setup global namespace
global.window = global.window || { Riptide: {} };
global.Riptide = global.window.Riptide || {};

// Load the module
require('../../public/js/severity');

const Severity = Riptide.Severity;

afterAll(() => {
  delete global.window;
  delete global.Riptide;
});

describe('Severity.next', () => {
  it('cycles null to info', () => {
    expect(Severity.next(null)).toBe('info');
  });

  it('cycles info to low', () => {
    expect(Severity.next('info')).toBe('low');
  });

  it('cycles low to medium', () => {
    expect(Severity.next('low')).toBe('medium');
  });

  it('cycles medium to high', () => {
    expect(Severity.next('medium')).toBe('high');
  });

  it('cycles high to critical', () => {
    expect(Severity.next('high')).toBe('critical');
  });

  it('cycles critical back to null', () => {
    expect(Severity.next('critical')).toBe(null);
  });

  it('treats undefined as null (cycles to null)', () => {
    // indexOf(undefined) returns -1, so (-1 + 1) % 6 = 0 which is null
    expect(Severity.next(undefined)).toBe(null);
  });

  it('treats unknown string as null (cycles to null)', () => {
    // indexOf('invalid') returns -1, so (-1 + 1) % 6 = 0 which is null
    expect(Severity.next('invalid')).toBe(null);
  });
});

describe('Severity.levels', () => {
  it('has correct order', () => {
    expect(Severity.levels).toEqual([null, 'info', 'low', 'medium', 'high', 'critical']);
  });
});
