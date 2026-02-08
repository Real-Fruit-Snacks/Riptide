// test/unit/output-parser.test.js

// Setup global namespace
global.window = { Riptide: {} };
global.Riptide = global.window.Riptide;
global.DOMPurify = { sanitize: (html) => html };

// Load the module
require('../../public/js/output-parser');

const OutputParser = Riptide.OutputParser;

afterAll(() => {
  delete global.window;
  delete global.Riptide;
  delete global.DOMPurify;
});

describe('OutputParser._extractFindings', () => {
  describe('IPv4 extraction', () => {
    it('extracts standard IPs', () => {
      const findings = OutputParser._extractFindings('10.10.10.1');
      const ips = findings.filter(f => f.type === 'ip');
      expect(ips).toHaveLength(1);
      expect(ips[0].value).toBe('10.10.10.1');
    });

    it('excludes 127.0.0.1', () => {
      const findings = OutputParser._extractFindings('127.0.0.1');
      const ips = findings.filter(f => f.type === 'ip');
      expect(ips).toHaveLength(0);
    });

    it('excludes 0.0.0.0', () => {
      const findings = OutputParser._extractFindings('0.0.0.0');
      const ips = findings.filter(f => f.type === 'ip');
      expect(ips).toHaveLength(0);
    });

    it('excludes 255.255.255.255', () => {
      const findings = OutputParser._extractFindings('255.255.255.255');
      const ips = findings.filter(f => f.type === 'ip');
      expect(ips).toHaveLength(0);
    });

    it('excludes IPs that are part of URLs', () => {
      const findings = OutputParser._extractFindings('http://10.10.10.1/path');
      const ips = findings.filter(f => f.type === 'ip');
      expect(ips).toHaveLength(0);
    });

    it('extracts standalone IP when URL is also present', () => {
      const findings = OutputParser._extractFindings('10.10.10.40 and http://192.168.1.1/test');
      const ips = findings.filter(f => f.type === 'ip');
      expect(ips).toHaveLength(1);
      expect(ips[0].value).toBe('10.10.10.40');
    });
  });

  describe('URL extraction', () => {
    it('extracts http URLs', () => {
      const findings = OutputParser._extractFindings('http://example.com');
      const urls = findings.filter(f => f.type === 'url');
      expect(urls).toHaveLength(1);
      expect(urls[0].value).toBe('http://example.com');
    });

    it('extracts https URLs', () => {
      const findings = OutputParser._extractFindings('https://example.com');
      const urls = findings.filter(f => f.type === 'url');
      expect(urls).toHaveLength(1);
      expect(urls[0].value).toBe('https://example.com');
    });

    it('handles URLs with paths and query strings', () => {
      const findings = OutputParser._extractFindings('https://example.com/path?query=value');
      const urls = findings.filter(f => f.type === 'url');
      expect(urls).toHaveLength(1);
      expect(urls[0].value).toBe('https://example.com/path?query=value');
    });
  });

  describe('Email extraction', () => {
    it('extracts standard email addresses', () => {
      const findings = OutputParser._extractFindings('admin@example.com');
      const emails = findings.filter(f => f.type === 'email');
      expect(emails).toHaveLength(1);
      expect(emails[0].value).toBe('admin@example.com');
    });

    it('extracts emails with dots and underscores', () => {
      const findings = OutputParser._extractFindings('john.doe_test@sub.domain.com');
      const emails = findings.filter(f => f.type === 'email');
      expect(emails).toHaveLength(1);
      expect(emails[0].value).toBe('john.doe_test@sub.domain.com');
    });
  });

  describe('Credential extraction', () => {
    it('matches Password=secret123', () => {
      const findings = OutputParser._extractFindings('Password=secret123');
      const creds = findings.filter(f => f.type === 'credential');
      expect(creds).toHaveLength(1);
      expect(creds[0].value).toBe('Password=secret123');
    });

    it('matches User:admin', () => {
      const findings = OutputParser._extractFindings('User:admin');
      const creds = findings.filter(f => f.type === 'credential');
      expect(creds).toHaveLength(1);
      expect(creds[0].value).toBe('User:admin');
    });

    it('matches user:pass@host format', () => {
      const findings = OutputParser._extractFindings('user:pass@host');
      const creds = findings.filter(f => f.type === 'credential');
      expect(creds).toHaveLength(1);
      expect(creds[0].value).toBe('user:pass@host');
    });

    it('matches password with pwd keyword', () => {
      const findings = OutputParser._extractFindings('pwd: secret');
      const creds = findings.filter(f => f.type === 'credential');
      expect(creds).toHaveLength(1);
    });

    it('matches Username=john', () => {
      const findings = OutputParser._extractFindings('Username=john');
      const creds = findings.filter(f => f.type === 'credential');
      expect(creds).toHaveLength(1);
      expect(creds[0].value).toBe('Username=john');
    });
  });

  describe('Hash extraction', () => {
    it('matches MD5 (32 hex chars)', () => {
      const findings = OutputParser._extractFindings('5d41402abc4b2a76b9719d911017c592');
      const hashes = findings.filter(f => f.type === 'hash');
      expect(hashes).toHaveLength(1);
      expect(hashes[0].label).toBe('MD5');
      expect(hashes[0].value).toBe('5d41402abc4b2a76b9719d911017c592');
    });

    it('matches SHA1 (40 hex chars)', () => {
      const findings = OutputParser._extractFindings('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
      const hashes = findings.filter(f => f.type === 'hash');
      expect(hashes).toHaveLength(1);
      expect(hashes[0].label).toBe('SHA1');
    });

    it('matches SHA256 (64 hex chars)', () => {
      const findings = OutputParser._extractFindings('2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae');
      const hashes = findings.filter(f => f.type === 'hash');
      expect(hashes).toHaveLength(1);
      expect(hashes[0].label).toBe('SHA256');
    });

    it('SHA256 does not also match as MD5 substring', () => {
      const findings = OutputParser._extractFindings('2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae');
      const hashes = findings.filter(f => f.type === 'hash');
      // Should only match SHA256, not MD5 (prevented by subsumption check)
      expect(hashes).toHaveLength(1);
      expect(hashes[0].label).toBe('SHA256');
    });

    it('adjacent hex chars prevent match', () => {
      // Hash with extra hex chars on both sides - should not match due to boundary check
      const findings = OutputParser._extractFindings('a5d41402abc4b2a76b9719d911017c592b');
      const hashes = findings.filter(f => f.type === 'hash');
      expect(hashes).toHaveLength(0);
    });

    it('hash with space boundary matches', () => {
      const findings = OutputParser._extractFindings('hash: 5d41402abc4b2a76b9719d911017c592 end');
      const hashes = findings.filter(f => f.type === 'hash');
      expect(hashes).toHaveLength(1);
    });
  });

  describe('Port extraction', () => {
    it('matches nmap tcp format', () => {
      const findings = OutputParser._extractFindings('80/tcp    open  http');
      const ports = findings.filter(f => f.type === 'port');
      expect(ports).toHaveLength(1);
      expect(ports[0].value).toBe('80/tcp    open  http');
    });

    it('matches nmap https port', () => {
      const findings = OutputParser._extractFindings('443/tcp   open  https');
      const ports = findings.filter(f => f.type === 'port');
      expect(ports).toHaveLength(1);
      expect(ports[0].value).toBe('443/tcp   open  https');
    });

    it('matches udp ports', () => {
      const findings = OutputParser._extractFindings('53/udp   open  domain');
      const ports = findings.filter(f => f.type === 'port');
      expect(ports).toHaveLength(1);
    });
  });

  describe('Realistic nmap output', () => {
    it('extracts multiple finding types from nmap scan', () => {
      const NMAP_OUTPUT = `Starting Nmap 7.94 ( https://nmap.org )
Nmap scan report for 10.10.10.40
PORT     STATE SERVICE
22/tcp   open  ssh
80/tcp   open  http
443/tcp  open  https
8080/tcp open  http-proxy`;

      const findings = OutputParser._extractFindings(NMAP_OUTPUT);
      const ips = findings.filter(f => f.type === 'ip');
      const ports = findings.filter(f => f.type === 'port');
      const urls = findings.filter(f => f.type === 'url');

      expect(ips).toHaveLength(1);
      expect(ips[0].value).toBe('10.10.10.40');
      expect(ports).toHaveLength(4);
      expect(urls).toHaveLength(1);
      expect(urls[0].value).toBe('https://nmap.org');
    });
  });

  describe('Edge cases', () => {
    it('empty string returns empty array', () => {
      const findings = OutputParser._extractFindings('');
      expect(findings).toEqual([]);
    });

    it('no matches returns empty array', () => {
      const findings = OutputParser._extractFindings('just some plain text');
      expect(findings).toEqual([]);
    });

    it('deduplicates identical findings', () => {
      const findings = OutputParser._extractFindings('10.10.10.1 10.10.10.1 10.10.10.1');
      const ips = findings.filter(f => f.type === 'ip');
      expect(ips).toHaveLength(1);
    });
  });
});

describe('OutputParser.analyze', () => {
  it('returns early for null text', () => {
    const mockEl = {};
    const result = OutputParser.analyze(mockEl, null);
    expect(result).toBeUndefined();
  });

  it('returns early for empty text', () => {
    const mockEl = {};
    const result = OutputParser.analyze(mockEl, '');
    expect(result).toBeUndefined();
  });

  it('returns early for text over 50KB', () => {
    const mockEl = {};
    const largeText = 'x'.repeat(51201); // Over _MAX_OUTPUT_LENGTH (51200)
    const result = OutputParser.analyze(mockEl, largeText);
    expect(result).toBeUndefined();
  });
});

describe('OutputParser._buildSummaryText', () => {
  it('formats single IP', () => {
    const findings = [{ type: 'ip' }];
    const summary = OutputParser._buildSummaryText(findings);
    expect(summary).toBe('1 IPs');
  });

  it('formats multiple types', () => {
    const findings = [
      { type: 'ip' }, { type: 'ip' }, { type: 'ip' },
      { type: 'url' }, { type: 'url' }
    ];
    const summary = OutputParser._buildSummaryText(findings);
    expect(summary).toBe('3 IPs, 2 URLs');
  });

  it('follows correct order: port, ip, url, email, credential, hash', () => {
    const findings = [
      { type: 'hash' },
      { type: 'ip' },
      { type: 'port' },
      { type: 'email' }
    ];
    const summary = OutputParser._buildSummaryText(findings);
    expect(summary).toBe('1 Ports, 1 IPs, 1 Emails, 1 Hashes');
  });

  it('handles empty findings', () => {
    const summary = OutputParser._buildSummaryText([]);
    expect(summary).toBe('');
  });
});

describe('OutputParser._groupFindings', () => {
  it('groups by type in correct order', () => {
    const findings = [
      { type: 'hash', value: 'abc' },
      { type: 'ip', value: '10.10.10.1' },
      { type: 'port', value: '80/tcp' }
    ];
    const groups = OutputParser._groupFindings(findings);
    expect(groups).toHaveLength(3);
    expect(groups[0].type).toBe('port');
    expect(groups[1].type).toBe('ip');
    expect(groups[2].type).toBe('hash');
  });

  it('includes correct display labels', () => {
    const findings = [
      { type: 'ip', value: '10.10.10.1' }
    ];
    const groups = OutputParser._groupFindings(findings);
    expect(groups[0].displayLabel).toBe('IPs');
  });

  it('groups multiple items of same type', () => {
    const findings = [
      { type: 'ip', value: '10.10.10.1' },
      { type: 'ip', value: '10.10.10.2' }
    ];
    const groups = OutputParser._groupFindings(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });
});

describe('OutputParser._escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(OutputParser._escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes less than', () => {
    expect(OutputParser._escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes greater than', () => {
    expect(OutputParser._escapeHtml('a>b')).toBe('a&gt;b');
  });

  it('escapes double quote', () => {
    expect(OutputParser._escapeHtml('a"b')).toBe('a&quot;b');
  });

  it('escapes multiple characters', () => {
    expect(OutputParser._escapeHtml('<a href="test">&</a>'))
      .toBe('&lt;a href=&quot;test&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('handles plain text unchanged', () => {
    expect(OutputParser._escapeHtml('plain text')).toBe('plain text');
  });
});
