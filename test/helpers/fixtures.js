'use strict';

const NMAP_OUTPUT = `Starting Nmap 7.94 ( https://nmap.org ) at 2024-01-15 10:30 UTC
Nmap scan report for 10.10.10.100
Host is up (0.045s latency).
Not shown: 995 closed tcp ports (reset)
PORT     STATE SERVICE     VERSION
22/tcp   open  ssh         OpenSSH 8.9p1 Ubuntu 3ubuntu0.4
80/tcp   open  http        Apache httpd 2.4.52
139/tcp  open  netbios-ssn Samba smbd 4.6.2
445/tcp  open  netbios-ssn Samba smbd 4.6.2
3306/tcp open  mysql       MySQL 8.0.35

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 12.34 seconds`;

const MARKDOWN_WITH_FRONTMATTER = `---
tags: [recon, nmap, scanning]
---
# Nmap Full Scan

Run a comprehensive nmap scan against the target.

\`\`\`bash
nmap -sC -sV -oA scan <TargetIP>
\`\`\`

## Quick TCP scan

\`\`\`bash
nmap -p- --min-rate 5000 <TargetIP>
\`\`\`
`;

const MARKDOWN_NO_FRONTMATTER = `# Simple Note

Just a regular note without frontmatter.

\`\`\`bash
whoami
\`\`\`
`;

const SAMPLE_CREDENTIALS = [
  { id: 'cred-1', service: 'SSH', username: 'admin', password: 'P@ssw0rd!', hash: '', notes: 'Root access' },
  { id: 'cred-2', service: 'MySQL', username: 'root', password: '', hash: '5f4dcc3b5aa765d61d8327deb882cf99', notes: 'DB admin' },
  { id: 'cred-3', service: 'FTP', username: 'backup', password: 'backup123', hash: '', notes: '' }
];

const SAMPLE_TAB = {
  id: 'a1b2c3d4',
  name: 'Target1',
  activeNoteId: null,
  variables: { TargetIP: '10.10.10.100', Domain: 'corp.local' },
  commandHistory: [],
  status: null,
  scope: {}
};

const SAMPLE_TAB_2 = {
  id: 'e5f6a7b8',
  name: 'Target2',
  activeNoteId: null,
  variables: { TargetIP: '10.10.10.200' },
  commandHistory: [],
  status: 'recon',
  scope: {}
};

const SAMPLE_ROOM = {
  id: 'test-room-001',
  name: 'Test Room',
  passwordHash: null, // Will be set during test setup
  workDir: null       // Will be set to temp dir during test setup
};

const SAMPLE_SCRATCH_NOTES = [
  { id: 'sn-1', content: 'Found open port 8080 on secondary interface', severity: 'medium', createdAt: Date.now() },
  { id: 'sn-2', content: 'Default credentials worked on admin panel', severity: 'high', createdAt: Date.now() }
];

const SAMPLE_GLOBAL_VARIABLES = {
  Domain: 'corp.local',
  DNSServer: '10.10.10.1',
  Wordlist: '/usr/share/wordlists/rockyou.txt'
};

module.exports = {
  NMAP_OUTPUT,
  MARKDOWN_WITH_FRONTMATTER,
  MARKDOWN_NO_FRONTMATTER,
  SAMPLE_CREDENTIALS,
  SAMPLE_TAB,
  SAMPLE_TAB_2,
  SAMPLE_ROOM,
  SAMPLE_SCRATCH_NOTES,
  SAMPLE_GLOBAL_VARIABLES
};
