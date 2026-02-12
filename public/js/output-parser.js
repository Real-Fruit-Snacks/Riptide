window.Riptide = window.Riptide || {};

Riptide.OutputParser = {

  _MAX_OUTPUT_LENGTH: 51200, // 50KB

  _patterns: [
    {
      category: 'port',
      label: 'Port',
      regex: /^(\d{1,5}\/(?:tcp|udp))\s+\S+\s+.+$/gm,
      action: 'scope-port'
    },
    {
      category: 'url',
      label: 'URL',
      regex: /https?:\/\/[^\s"'<>\)\]]+/g,
      action: 'copy'
    },
    {
      category: 'email',
      label: 'Email',
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      action: 'copy'
    },
    {
      category: 'credential',
      label: 'Credential',
      regexes: [
        /[Pp]assword\s*[=:]\s*\S+/g,
        /[Uu]ser(?:name)?\s*[=:]\s*\S+/g,
        /[Pp]wd\s*[=:]\s*\S+/g,
        /\S+:\S+@\S+/g
      ],
      action: 'add-credential'
    },
    {
      category: 'hash',
      label: 'SHA256',
      regex: /\b[a-f0-9]{64}\b/gi,
      action: 'add-hash'
    },
    {
      category: 'hash',
      label: 'SHA1',
      regex: /\b[a-f0-9]{40}\b/gi,
      action: 'add-hash'
    },
    {
      category: 'hash',
      label: 'MD5',
      regex: /\b[a-f0-9]{32}\b/gi,
      action: 'add-hash'
    },
    {
      category: 'ip',
      label: 'IPv4',
      regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
      action: 'scope-ip'
    }
  ],

  _excludedIPs: new Set(['127.0.0.1', '0.0.0.0', '255.255.255.255']),

  analyze(outputPreEl, rawText) {
    if (!rawText || rawText.length === 0 || rawText.length > this._MAX_OUTPUT_LENGTH) {
      return;
    }

    // Remove any existing toolbar
    const existingToolbar = outputPreEl.previousElementSibling;
    if (existingToolbar && existingToolbar.classList.contains('output-findings')) {
      existingToolbar.remove();
    }

    const findings = this._extractFindings(rawText);
    if (findings.length === 0) {
      return;
    }

    this._insertToolbar(outputPreEl, findings);
    this._highlightMatches(outputPreEl, findings);
  },

  _extractFindings(text) {
    const seen = new Set();
    const findings = [];
    const urlValues = new Set();

    // Collect URL values first so we can exclude IPs that are part of URLs
    for (const pat of this._patterns) {
      if (pat.category === 'url') {
        const re = new RegExp(pat.regex.source, pat.regex.flags);
        let m;
        while ((m = re.exec(text)) !== null) {
          urlValues.add(m[0]);
        }
      }
    }

    // Track hash match positions to prevent substring matches
    const hashPositions = []; // {start, end, len}

    for (const pat of this._patterns) {
      if (pat.regexes) {
        // Credential patterns — multiple regexes
        for (const rx of pat.regexes) {
          const re = new RegExp(rx.source, rx.flags);
          let m;
          while ((m = re.exec(text)) !== null) {
            const key = pat.category + ':' + m[0];
            if (!seen.has(key)) {
              seen.add(key);
              findings.push({
                type: pat.category,
                value: m[0],
                label: pat.label,
                start: m.index,
                end: m.index + m[0].length,
                action: pat.action
              });
            }
          }
        }
        continue;
      }

      const re = new RegExp(pat.regex.source, pat.regex.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        const value = m[0];

        // Filter excluded IPs
        if (pat.category === 'ip') {
          if (this._excludedIPs.has(value)) continue;
          // Exclude IPs that are part of a URL
          let partOfUrl = false;
          for (const u of urlValues) {
            if (u.includes(value)) {
              partOfUrl = true;
              break;
            }
          }
          if (partOfUrl) continue;
        }

        // Hash substring check — skip if this match is part of a longer hex string
        if (pat.category === 'hash') {
          const charBefore = m.index > 0 ? text[m.index - 1] : '';
          const charAfter = m.index + value.length < text.length ? text[m.index + value.length] : '';
          const hexChar = /[a-f0-9]/i;
          if (hexChar.test(charBefore) || hexChar.test(charAfter)) {
            continue;
          }
          // Check if this position is already covered by a longer hash match
          let subsumed = false;
          for (const hp of hashPositions) {
            if (m.index >= hp.start && m.index + value.length <= hp.end) {
              subsumed = true;
              break;
            }
          }
          if (subsumed) continue;
          hashPositions.push({ start: m.index, end: m.index + value.length, len: value.length });
        }

        const key = pat.category + ':' + value;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({
            type: pat.category,
            value: value,
            label: pat.label,
            start: m.index,
            end: m.index + value.length,
            action: pat.action
          });
        }
      }
    }

    return findings;
  },

  _insertToolbar(outputPreEl, findings) {
    const toolbar = document.createElement('div');
    toolbar.className = 'output-findings';

    // Build summary
    const summary = document.createElement('div');
    summary.className = 'of-summary';

    const icon = document.createElement('span');
    icon.className = 'of-icon';
    icon.textContent = '\u26A1';

    const summaryText = document.createElement('span');
    summaryText.className = 'of-text';
    summaryText.textContent = 'Found: ' + this._buildSummaryText(findings);

    const toggle = document.createElement('span');
    toggle.className = 'of-toggle';
    toggle.textContent = '\u25BC';

    summary.appendChild(icon);
    summary.appendChild(summaryText);
    summary.appendChild(toggle);

    // Build details
    const details = document.createElement('div');
    details.className = 'of-details hidden';

    // Group findings by category
    const groups = this._groupFindings(findings);
    for (const group of groups) {
      const catDiv = document.createElement('div');
      catDiv.className = 'of-category';

      const catLabel = document.createElement('span');
      catLabel.className = 'of-cat-label of-cat-' + group.type;
      catLabel.textContent = group.displayLabel + ' (' + group.items.length + ')';

      catDiv.appendChild(catLabel);

      const itemsDiv = document.createElement('div');
      itemsDiv.className = 'of-items';

      for (const finding of group.items) {
        const inScope = this._isInScope(finding);
        const itemDiv = document.createElement('div');
        itemDiv.className = inScope ? 'of-item of-in-scope' : 'of-item';

        const valueSpan = document.createElement('span');
        valueSpan.className = 'of-value';
        valueSpan.textContent = finding.value;
        valueSpan.title = finding.value;
        itemDiv.appendChild(valueSpan);

        // Primary action button
        if (finding.action !== 'copy') {
          if (inScope) {
            const badge = document.createElement('span');
            badge.className = 'of-in-scope-badge';
            badge.textContent = '\u2713 Scope';
            badge.title = 'Already in scope';
            itemDiv.appendChild(badge);
          } else {
            const promoteBtn = document.createElement('button');
            promoteBtn.className = 'of-promote';
            promoteBtn.dataset.action = finding.action;
            promoteBtn.title = this._getActionTitle(finding.action);
            promoteBtn.textContent = this._getActionLabel(finding.action);
            promoteBtn.addEventListener('click', () => {
              this._handleAction(finding.action, finding.value, finding.label);
            });
            itemDiv.appendChild(promoteBtn);
          }
        }

        // Copy button (always present)
        const copyBtn = document.createElement('button');
        copyBtn.className = 'of-promote';
        copyBtn.dataset.action = 'copy';
        copyBtn.title = 'Copy';
        copyBtn.textContent = '\uD83D\uDCCB';
        copyBtn.addEventListener('click', () => {
          this._handleAction('copy', finding.value, finding.label);
        });
        itemDiv.appendChild(copyBtn);

        itemsDiv.appendChild(itemDiv);
      }

      catDiv.appendChild(itemsDiv);
      details.appendChild(catDiv);
    }

    // Toggle behavior
    summary.addEventListener('click', () => {
      const isHidden = details.classList.contains('hidden');
      if (isHidden) {
        details.classList.remove('hidden');
        toggle.textContent = '\u25BC';
      } else {
        details.classList.add('hidden');
        toggle.textContent = '\u25B6';
      }
    });

    toolbar.appendChild(summary);
    toolbar.appendChild(details);
    outputPreEl.parentNode.insertBefore(toolbar, outputPreEl);
  },

  _buildSummaryText(findings) {
    const counts = {};
    const labelMap = {
      ip: 'IPs',
      url: 'URLs',
      email: 'Emails',
      hash: 'Hashes',
      credential: 'Credentials',
      port: 'Ports'
    };

    for (const f of findings) {
      counts[f.type] = (counts[f.type] || 0) + 1;
    }

    const parts = [];
    const order = ['port', 'ip', 'url', 'email', 'credential', 'hash'];
    for (const type of order) {
      if (counts[type]) {
        parts.push(counts[type] + ' ' + labelMap[type]);
      }
    }
    return parts.join(', ');
  },

  _groupFindings(findings) {
    const groupMap = {};
    const displayLabels = {
      port: 'Ports',
      ip: 'IPs',
      url: 'URLs',
      email: 'Emails',
      credential: 'Credentials',
      hash: 'Hashes'
    };
    const order = ['port', 'ip', 'url', 'email', 'credential', 'hash'];

    for (const f of findings) {
      if (!groupMap[f.type]) {
        groupMap[f.type] = {
          type: f.type,
          displayLabel: displayLabels[f.type] || f.type,
          items: []
        };
      }
      groupMap[f.type].items.push(f);
    }

    const groups = [];
    for (const type of order) {
      if (groupMap[type]) {
        groups.push(groupMap[type]);
      }
    }
    return groups;
  },

  _getActionTitle(action) {
    const titles = {
      'scope-ip': 'Set as Target IP',
      'scope-port': 'Add to scope ports',
      'add-credential': 'Add credential',
      'add-hash': 'Add as variable',
      'copy': 'Copy'
    };
    return titles[action] || action;
  },

  _getActionLabel(action) {
    const labels = {
      'scope-ip': '\u2192 Scope',
      'scope-port': '\u2192 Scope',
      'add-credential': '+ Creds',
      'add-hash': '+ Var'
    };
    return labels[action] || action;
  },

  _handleAction(action, value, label) {
    switch (action) {
    case 'scope-ip': {
      const tab = Riptide.Tabs.getActiveTab();
      if (tab) {
        if (!tab.scope) tab.scope = {};
        if (tab.scope.ip === value) {
          Riptide.toast('IP already in scope');
          break;
        }
        tab.scope.ip = value;
        Riptide.Scope.load(Riptide.Tabs.activeTabId);
        Riptide.Scope._onFieldChange('ip', value);
      }
      Riptide.toast('IP added to scope');
      break;
    }
    case 'scope-port': {
      const tab = Riptide.Tabs.getActiveTab();
      if (tab) {
        if (!tab.scope) tab.scope = {};
        const existing = tab.scope.ports || '';
        const portMatch = value.match(/^(\d+\/\w+)/);
        const portNum = portMatch ? portMatch[0] : value;
        if (existing.split(',').some(p => p.trim() === portNum)) {
          Riptide.toast('Port already in scope');
          break;
        }
        tab.scope.ports = existing ? existing + ', ' + portNum : portNum;
        Riptide.Scope.load(Riptide.Tabs.activeTabId);
        Riptide.Scope._onFieldChange('ports', tab.scope.ports);
      }
      Riptide.toast('Port added to scope');
      break;
    }
    case 'add-credential': {
      let username = '';
      let password = '';
      if (value.includes(':') && value.includes('@')) {
        // user:pass@host format
        const parts = value.split('@')[0];
        const colonIdx = parts.indexOf(':');
        username = parts.substring(0, colonIdx);
        password = parts.substring(colonIdx + 1);
      } else {
        const match = value.match(/[=:]\s*(\S+)/);
        if (/[Pp]ass|[Pp]wd/.test(value)) {
          password = match ? match[1] : value;
        } else {
          username = match ? match[1] : value;
        }
      }
      // Check if credential already exists
      const allCreds = [
        ...(Riptide.Credentials.entries || []),
        ...(Riptide.Credentials.globalEntries || [])
      ];
      const exists = allCreds.some(c =>
        c.username === username && c.password === password
      );
      if (exists) {
        Riptide.toast('Credential already exists');
        break;
      }
      Riptide.Credentials.addCredential({ username, password, service: '' });
      Riptide.toast('Credential added');
      break;
    }
    case 'add-hash': {
      const shortHash = value.substring(0, 8);
      const tab = Riptide.Tabs.getActiveTab();
      if (tab) {
        if (!tab.variables) tab.variables = {};
        const varName = label + '_' + shortHash;
        // Check if variable already exists with this value
        const existingVal = tab.variables[varName];
        const globalVars = Riptide.Variables ? Riptide.Variables._globalVars : {};
        if (existingVal === value || (globalVars && globalVars[varName] === value)) {
          Riptide.toast('Hash already saved as variable');
          break;
        }
        tab.variables[varName] = value;
        Riptide.Tabs.setTabVariables(Riptide.Tabs.activeTabId, tab.variables);
        Riptide.Variables.refresh();
      }
      Riptide.toast('Hash added as variable');
      break;
    }
    case 'copy':
      Riptide.clipboard(value);
      break;
    }
  },

  _highlightMatches(outputPreEl, findings) {
    const codeEl = outputPreEl.querySelector('code');
    if (!codeEl) return;

    const plainText = codeEl.textContent;

    // Build positions from findings (already extracted)
    const positions = findings.map(f => ({
      start: f.start,
      end: f.end,
      type: f.type
    }));

    if (positions.length === 0) return;

    // Sort by start position, then by length descending (longer match first)
    positions.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

    // Resolve overlaps: keep the one that started first
    const resolved = [positions[0]];
    for (let i = 1; i < positions.length; i++) {
      const last = resolved[resolved.length - 1];
      if (positions[i].start >= last.end) {
        resolved.push(positions[i]);
      }
    }

    // Build highlighted HTML
    const parts = [];
    let cursor = 0;
    for (const pos of resolved) {
      if (pos.start > cursor) {
        parts.push(this._escapeHtml(plainText.substring(cursor, pos.start)));
      }
      const matchedText = plainText.substring(pos.start, pos.end);
      parts.push(
        '<span class="finding-hl finding-hl-' + pos.type + '">' +
        this._escapeHtml(matchedText) +
        '</span>'
      );
      cursor = pos.end;
    }
    if (cursor < plainText.length) {
      parts.push(this._escapeHtml(plainText.substring(cursor)));
    }

    codeEl.innerHTML = DOMPurify.sanitize(parts.join(''), { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] });
  },

  _isInScope(finding) {
    const tab = Riptide.Tabs ? Riptide.Tabs.getActiveTab() : null;
    if (!tab || !tab.scope) return false;

    if (finding.action === 'scope-ip') {
      return tab.scope.ip === finding.value;
    }
    if (finding.action === 'scope-port') {
      if (!tab.scope.ports) return false;
      const portMatch = finding.value.match(/^(\d+\/\w+)/);
      const portStr = portMatch ? portMatch[0] : finding.value;
      return tab.scope.ports.split(',').some(p => p.trim() === portStr);
    }
    return false;
  },

  _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};
