<div align="center">

<img src="docs/logo.svg" alt="Riptide" width="480">

<br>

**Collaborative terminal + playbook workspace for penetration testing and CTF teams**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Real-Fruit-Snacks/Riptide/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/Tests-630%20passing-brightgreen.svg)](#testing)

<br>

Riptide is a browser-based platform that combines a persistent PTY terminal with stackable markdown playbooks, real-time multi-user collaboration, and structured data management — built for pentest engagements, CTF competitions, and red team operations. Think of it as a shared war room where your team runs commands, documents findings, and manages credentials in one place.

<br>

<img src="docs/screenshot.png" alt="Riptide — Active engagement workspace with playbooks, credentials, and terminal" width="900">

</div>

<br>

## Table of Contents

- [Highlights](#highlights)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Security](#security)
- [Configuration](#configuration)
- [Playbooks](#playbooks)
- [Testing](#testing)
- [Contributing](#contributing)

---

## Highlights

<table>
<tr>
<td width="50%">

### Terminal + Playbooks
A full xterm.js terminal on the right, stackable markdown note sections on the left. Fenced code blocks get **Run** buttons that execute directly in the terminal — click to run, capture the output, and it's saved back into your notes.

</td>
<td width="50%">

### Real-Time Collaboration
Password-protected rooms with WebSocket sync. Multiple users see each other's presence, get live updates on notes/credentials/variables, and edit locks prevent conflicts. Late-joining users see buffered terminal output (up to 256KB per PTY).

</td>
</tr>
<tr>
<td width="50%">

### Variable Substitution
Use `<TargetIP>`, `<Domain>`, or any custom variable in code blocks. Riptide scans your playbooks, renders input fields, and substitutes values at runtime. Variables support **tab** (per-target) and **global** (room-wide) scope.

</td>
<td width="50%">

### Credential Vault
Store service/username/password/hash combos per target or globally. Click-to-reveal secrets, one-click copy, bulk export to `credentials.txt` / `usernames.txt` / `passwords_hashes.txt`. Flag findings to alert the whole team.

</td>
</tr>
<tr>
<td width="50%">

### Output Intelligence
After capturing terminal output, the parser automatically extracts IPs, URLs, emails, hashes, credentials, and nmap ports — highlighted inline with one-click promote actions to push findings into the credential vault or scope panel.

</td>
<td width="50%">

### Playbook Library
Build your own library of reusable playbooks organized by category and tags. Search, import into rooms, customize, and share across engagements.

</td>
</tr>
<tr>
<td width="50%">

### Target Scope Tracking
Per-tab scope panel for IP, hostname, OS, open ports, services, and notes. Tab status badges cycle through recon / exploit / post-exploit / pwned / blocked to track engagement progress at a glance.

</td>
<td width="50%">

### 4 Catppuccin Themes
Full theming support with all four Catppuccin flavors — Macchiato (default), Mocha, Frappe, and Latte. Every color in the app responds to theme changes instantly.

</td>
</tr>
</table>

---

## Quick Start

### Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | >= 18 |
| npm | >= 9 |
| Platform | Linux, macOS, or Windows (with build tools for [node-pty](https://github.com/nicedoc/node-pty)) |

### Install & Launch

```bash
git clone https://github.com/Real-Fruit-Snacks/Riptide.git
cd Riptide
npm install
npm start
```

Open **https://localhost:3000** in your browser. Create a room, set a password, and you're in.

> HTTPS is enabled by default — Riptide auto-generates a self-signed certificate on first launch (requires `openssl` on your PATH). Your browser will warn about the self-signed cert; accept it to proceed.

```bash
# Disable HTTPS
NO_SSL=1 npm start

# Use your own certificate
SSL_KEY=/path/to/your.key SSL_CERT=/path/to/your.cert npm start

# Or use the launch script with flags
./start.sh --no-ssl --port 8443
```

### Development

```bash
npm run dev          # Start with --watch (auto-restart on changes)
npm run lint         # ESLint with 0-warning policy
npm test             # Run all 630 tests
npm run test:watch   # Watch mode
```

---

## Architecture

Riptide is a vanilla JavaScript application with **no build step** — static files are served directly from `public/`. The backend is a modular Express server with dual WebSocket support for real-time sync and terminal I/O.

```
Riptide/
├── server.js              # Express config, middleware, WebSocket, PTY management
├── lib/
│   ├── storage.js         # File I/O, path resolution, atomic JSON updates
│   └── helpers.js         # Validation, hashing, frontmatter parsing
├── routes/                # 13 Express Router modules
│   ├── rooms.js           # Room CRUD, join/leave
│   ├── tabs.js            # Tab management, status, scope
│   ├── notes.js           # Playbook notes CRUD, ordering, severity
│   ├── credentials.js     # Credential vault (tab + global scope)
│   ├── variables.js       # Variable management (tab + global scope)
│   ├── scratch-notes.js   # Quick notes with severity
│   ├── history.js         # Command history per tab
│   ├── files.js           # File upload/download per tab
│   ├── playbooks.js       # Playbook library search and import
│   ├── alerts.js          # Flagged finding alert history
│   ├── recordings.js      # Terminal session recording
│   ├── audit.js           # Audit log
│   └── session.js         # Session reset, cleanup
├── playbooks/             # User playbook library (.md files)
├── public/
│   ├── css/
│   │   ├── theme.css      # Catppuccin theme definitions (4 flavors)
│   │   └── style.css      # Application styles (~5700 lines)
│   ├── js/                # 35 frontend modules on Riptide.* namespace
│   └── index.html         # Single-page shell
└── test/                  # 630 tests across 25 files
    ├── unit/              # Pure logic tests
    ├── integration/       # HTTP + WebSocket tests
    └── helpers/           # Test factories and fixtures
```

### Dual WebSocket System

| Endpoint | Purpose | Details |
|----------|---------|---------|
| `/ws/terminal` | PTY I/O | stdin/stdout streaming, resize events, 256KB ring buffer for late-join replay |
| `/ws/sync` | State broadcast | Note edits, credential changes, presence tracking, edit locks, finding alerts |

### Data Storage

Each room can specify a **working directory** — a filesystem path where all engagement data lives, organized by target:

```
{workDir}/
├── tabs.json                    # Tab config, variables
├── global-credentials.json      # Room-wide credentials
├── global-variables.json        # Room-wide variables
├── alerts.json                  # Flagged findings (capped at 200)
└── {TargetName}/                # Per-target folder
    ├── *.md                     # Playbook notes
    ├── credentials.json         # Target-scoped credentials
    ├── scratch-notes.json       # Quick notes
    └── credentials.txt          # Exported credentials
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Server** | Node.js, Express 4, WebSocket (ws) |
| **Terminal** | node-pty (server), xterm.js 5 (client) |
| **Editor** | CodeMirror 6 (markdown mode) |
| **Markdown** | marked + PrismJS syntax highlighting |
| **Security** | helmet, express-rate-limit, DOMPurify, scrypt hashing |
| **Theming** | Catppuccin via CSS custom properties |
| **Testing** | Vitest, supertest |
| **Linting** | ESLint 9 (flat config) |

No build step. No bundler. No framework. Just modules.

---

## Features

| Feature | Description |
|---------|-------------|
| **Persistent terminal** | Full PTY with scrollback, web links, fit-to-container |
| **Markdown playbooks** | Stackable sections with Run buttons on code blocks |
| **Run All** | Execute every code block in a playbook sequentially |
| **Output capture** | Grab terminal output and save it back into your notes |
| **Playbook library** | Build, browse, search, and import your own templates |
| **Variable system** | `<VarName>` syntax with tab + global scope |
| **Credential vault** | Service/user/pass/hash per target or global, with export |
| **Output parser** | Auto-extract IPs, URLs, hashes, creds, ports from output |
| **Target scope** | IP, hostname, OS, ports, services per tab |
| **Tab status** | Recon / exploit / post-exploit / pwned / blocked badges |
| **Finding alerts** | Flag findings with team-wide toast + browser notifications |
| **Scratch notes** | Quick notes with severity levels per target |
| **File management** | Per-tab upload, drag-and-drop, gallery view |
| **Terminal recording** | Record and replay terminal sessions |
| **Edit locking** | Prevents concurrent edits on the same note |
| **User presence** | Avatars, tab presence dots, who's-where tracking |
| **Keyboard shortcuts** | Configurable hotkeys for common actions |
| **Theme support** | 4 Catppuccin flavors (Latte, Frappe, Macchiato, Mocha) |
| **Audit log** | Track room activity |
| **Session management** | Room admin controls, session reset |

---

## Security

Riptide is designed for use on trusted networks during authorized engagements.

| Layer | Implementation |
|-------|----------------|
| **Authentication** | scrypt password hashing (N=32768, r=8, p=2), 24-hour session expiry |
| **TLS** | HTTPS by default with auto-generated self-signed certs, TLS 1.2 minimum |
| **Transport** | helmet (CSP, HSTS, X-Frame-Options), WebSocket origin validation |
| **Rate limiting** | 15 requests per 15 minutes on auth endpoints |
| **Sanitization** | DOMPurify on all rendered markdown, path traversal protection |
| **Body limits** | 256KB request body limit |

> **Warning**: Riptide is intended for internal/lab use during engagements. Do not expose to the public internet without additional hardening — proper CA-signed certificates, reverse proxy, and network-level access control.

---

## Configuration

Riptide uses sensible defaults with no config file required. Customize via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `NO_SSL` | *(unset)* | Set to `1` to disable HTTPS |
| `SSL_KEY` | `certs/server.key` | Path to TLS private key |
| `SSL_CERT` | `certs/server.cert` | Path to TLS certificate |

Theme selection is per-user via **Settings > General > Theme** and persists in localStorage.

---

## Playbooks

Playbooks are markdown files in the `playbooks/` directory. Add frontmatter for metadata:

````markdown
---
title: Network Reconnaissance
description: Initial network enumeration and service discovery
category: Recon
tags: [nmap, network, enumeration]
---

## Host Discovery

```bash
nmap -sn <TargetSubnet>
```

## Port Scan

```bash
nmap -sCV -p- <TargetIP> -oN nmap_full.txt
```
````

Variables like `<TargetIP>` are detected automatically and rendered as input fields in the UI. Values persist per-tab and substitute at runtime when you click **Run**.

---

## Testing

```bash
npm test                      # All 630 tests
npm run test:unit             # Unit tests only
npm run test:integration      # Integration tests only
npm run test:coverage         # With V8 coverage report
npx vitest run -t "pattern"   # Run tests matching a name
```

Tests are fully isolated — each file creates its own temp directory and cleans up after itself. No shared state between test files.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `npm run lint && npm test` — both must pass with 0 warnings
5. Commit with a descriptive message
6. Open a Pull Request

### Code Style

- Vanilla JS on the `Riptide.*` namespace — no frameworks, no bundler
- ESLint with 0-warning policy
- Hover-reveal pattern for action buttons (hidden until parent hover)
- Delete confirmations on all destructive actions
- All REST mutations broadcast via WebSocket for real-time sync

See [SECURITY.md](SECURITY.md) for vulnerability reporting guidelines.

---

<div align="center">

**Built for offense. Designed for teams.**

[GitHub](https://github.com/Real-Fruit-Snacks/Riptide) | [License (MIT)](https://github.com/Real-Fruit-Snacks/Riptide/blob/main/LICENSE) | [Report Issue](https://github.com/Real-Fruit-Snacks/Riptide/issues)

*Riptide — collaborative pentest workspace*

</div>
