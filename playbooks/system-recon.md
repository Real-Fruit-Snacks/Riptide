---
tags: [recon, networking, system]
category: Reconnaissance
---
# System Reconnaissance

Gather basic information about the target system.

## Host Info

```bash
hostname && whoami && id
```

## Network Interfaces

```bash
ip addr show
```

## Listening Ports

```bash
ss -tlnp
```

## OS Version

```bash
cat /etc/os-release
```
