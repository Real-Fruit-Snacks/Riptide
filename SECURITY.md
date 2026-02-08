# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Riptide, please report it responsibly.

**Do not open a public issue.** Instead, email the maintainer or use [GitHub's private vulnerability reporting](https://github.com/Real-Fruit-Snacks/Riptide/security/advisories/new).

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You can expect an initial response within 48 hours.

## Scope

Riptide is designed for use in authorized penetration testing environments. The following are considered in-scope for security reports:

- Authentication bypass
- Session hijacking or token leakage
- Path traversal / file access outside allowed directories
- Cross-site scripting (XSS) in rendered content
- Command injection via terminal or API inputs
- WebSocket authentication issues
- Credential storage weaknesses

## Out of Scope

- Vulnerabilities in third-party dependencies (report upstream)
- Self-signed certificate warnings (expected behavior)
- Denial of service against localhost instances
