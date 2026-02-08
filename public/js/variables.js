window.Riptide = window.Riptide || {};

Riptide.Variables = {
  _panel: null,
  _saveTimeout: null,
  _globalSaveTimeout: null,
  _globalVars: {},

  init() {
    this._panel = Riptide.CollapsiblePanel.create({
      sectionId: 'variables-section',
      listId: 'variables-list',
      headerId: 'variables-header',
      chevronClass: 'var-chevron',
      badgeClass: 'var-badge'
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'var-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add variable manually';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._addManual();
    });
    this._panel.header.appendChild(addBtn);

    this._panel.section.classList.remove('hidden');
  },

  async loadGlobalVars() {
    try {
      this._globalVars = await Riptide.api('/api/variables');
    } catch {
      this._globalVars = {};
    }
  },

  getEffective() {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    const tabVars = tabId ? Riptide.Tabs.getTabVariables(tabId) : {};
    return { ...this._globalVars, ...tabVars };
  },

  scanPlaybook(content) {
    const vars = new Set();
    const codeBlockRegex = /```([a-z:]*)\n([\s\S]*?)```/g;
    const varRegex = /<([A-Za-z_][A-Za-z0-9_]*)>/g;

    let blockMatch;
    while ((blockMatch = codeBlockRegex.exec(content)) !== null) {
      const lang = blockMatch[1];
      if (lang === 'output') continue;
      const blockContent = blockMatch[2];
      varRegex.lastIndex = 0;
      let varMatch;
      while ((varMatch = varRegex.exec(blockContent)) !== null) {
        vars.add(varMatch[1]);
      }
    }
    return vars;
  },

  refresh() {
    const tabId = Riptide.Tabs.activeTabId;
    if (!tabId) {
      this._panel.list.innerHTML = '';
      this._updateBadge(0, 0);
      return;
    }

    const { detected, playbookVars } = this._getDetectedVars();

    if (detected.size === 0 && Object.keys(this._globalVars).length === 0) {
      this._panel.list.innerHTML = '';
      this._updateBadge(0, 0);
      return;
    }

    // Preserve focus state before re-render
    let focusedVarName = null;
    let cursorPos = 0;
    const activeEl = document.activeElement;
    if (activeEl && activeEl.classList.contains('var-input')) {
      const row = activeEl.closest('.var-row');
      if (row) {
        focusedVarName = row.querySelector('.var-label')?.textContent;
        cursorPos = activeEl.selectionStart || 0;
      }
    }

    const tabStored = Riptide.Tabs.getTabVariables(tabId);
    this._render(detected, tabStored, playbookVars);

    // Restore focus
    if (focusedVarName) {
      const labels = this._panel.list.querySelectorAll('.var-label');
      for (const label of labels) {
        if (label.textContent === focusedVarName) {
          const input = label.parentElement.querySelector('.var-input');
          if (input) {
            input.focus();
            input.setSelectionRange(cursorPos, cursorPos);
          }
          break;
        }
      }
    }

    const effective = this.getEffective();
    const allNames = new Set([...detected, ...Object.keys(this._globalVars)]);
    const filledCount = [...allNames].filter(n => effective[n]).length;
    this._updateBadge(filledCount, allNames.size);
  },

  _getDetectedVars() {
    const tabId = Riptide.Tabs.activeTabId;
    const detected = new Set();
    const playbookVars = new Set();

    for (const section of Riptide.Playbooks.sections.values()) {
      if (section.expanded && section.content) {
        for (const v of this.scanPlaybook(section.content)) {
          detected.add(v);
          playbookVars.add(v);
        }
      }
    }

    const stored = tabId ? Riptide.Tabs.getTabVariables(tabId) : {};
    for (const name of Object.keys(stored)) {
      detected.add(name);
    }

    return { detected, playbookVars };
  },

  _updateBadge(filled, total) {
    if (total === 0) {
      this._panel.badge.textContent = '';
      return;
    }
    this._panel.badge.textContent = filled + '/' + total;
    this._panel.badge.className = 'var-badge' + (filled === total ? ' var-badge-complete' : '');
  },

  _render(varNames, tabStored, playbookVars) {
    this._panel.list.innerHTML = '';
    const frag = document.createDocumentFragment();

    // Merge all variable names: detected (tab) + global
    const allNames = new Set([...varNames, ...Object.keys(this._globalVars)]);
    const sorted = [...allNames].sort();

    for (const name of sorted) {
      const isInTab = name in tabStored;
      const isInGlobal = name in this._globalVars;
      const isPlaybookDetected = playbookVars.has(name);
      // Determine effective scope: if in tab vars, scope is tab; if only global, scope is global
      const scope = isInTab ? 'tab' : (isInGlobal ? 'global' : 'tab');
      const effectiveValue = isInTab ? (tabStored[name] || '') : (this._globalVars[name] || '');

      const row = document.createElement('div');
      row.className = 'var-row';

      // Scope badge (only for non-playbook-detected vars or global vars)
      if (!isPlaybookDetected || isInGlobal) {
        const scopeBadge = document.createElement('span');
        scopeBadge.className = `var-scope-badge var-scope-${scope}`;
        scopeBadge.textContent = scope === 'global' ? 'G' : 'T';
        scopeBadge.title = scope === 'global' ? 'Global (all tabs) — click to make tab-only' : 'Tab-specific — click to make global';
        scopeBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          this._toggleScope(name, scope, effectiveValue);
        });
        row.appendChild(scopeBadge);
      }

      const label = document.createElement('span');
      label.className = 'var-label';
      label.textContent = name;
      label.title = 'Click to copy value';
      label.addEventListener('click', () => {
        const val = this.getEffective()[name] || '';
        if (!val) {
          this._toast(name + ' is unset');
          return;
        }
        Riptide.clipboard(val, name + ' value');
      });

      const input = document.createElement('input');
      input.className = 'var-input';
      input.type = 'text';
      input.spellcheck = false;
      input.placeholder = 'unset';
      input.value = effectiveValue;

      this._applyInputState(input);

      input.addEventListener('input', () => {
        this._applyInputState(input);
        this._onValueChange(name, input.value, scope);
      });

      row.appendChild(label);
      row.appendChild(input);

      // Show delete button for variables NOT referenced in any playbook
      if (!playbookVars.has(name)) {
        const delBtn = document.createElement('button');
        delBtn.className = 'var-del-btn';
        delBtn.innerHTML = '&times;';
        delBtn.title = 'Remove variable';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._removeVariable(name, scope);
        });
        row.appendChild(delBtn);
      }

      frag.appendChild(row);
    }
    this._panel.list.appendChild(frag);
  },

  _applyInputState(input) {
    if (input.value.trim()) {
      input.classList.add('var-filled');
      input.classList.remove('var-empty');
    } else {
      input.classList.add('var-empty');
      input.classList.remove('var-filled');
    }
  },

  _onValueChange(name, value, scope) {
    if (scope === 'global') {
      this._globalVars[name] = value;

      Riptide.Preview.updateAllVariables();

      clearTimeout(this._globalSaveTimeout);
      this._globalSaveTimeout = setTimeout(() => {
        // Update badge count on debounced save (avoids scanning on every keystroke)
        const effective = this.getEffective();
        const allNames = new Set([...this._getDetectedVars().detected, ...Object.keys(this._globalVars)]);
        if (allNames.size > 0) {
          const filledCount = [...allNames].filter(n => effective[n]).length;
          this._updateBadge(filledCount, allNames.size);
        }
        this._saveGlobalVars();
      }, 500);
      return;
    }

    const tabId = Riptide.Tabs.activeTabId;
    if (!tabId) return;

    const tab = Riptide.Tabs.getActiveTab();
    if (!tab.variables) tab.variables = {};
    tab.variables[name] = value;

    Riptide.Preview.updateAllVariables();

    clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      // Update badge count on debounced save (avoids scanning on every keystroke)
      const effective = this.getEffective();
      const allNames = new Set([...this._getDetectedVars().detected, ...Object.keys(this._globalVars)]);
      if (allNames.size > 0) {
        const filledCount = [...allNames].filter(n => effective[n]).length;
        this._updateBadge(filledCount, allNames.size);
      }
      Riptide.Tabs.setTabVariables(tabId, tab.variables);
    }, 500);
  },

  async _saveGlobalVars() {
    try {
      await Riptide.api('/api/variables', {
        method: 'PATCH',
        body: { variables: this._globalVars }
      });
    } catch {
      this._toast('Failed to save global variable');
    }
  },

  async _toggleScope(name, currentScope, value) {
    if (currentScope === 'tab') {
      // Move from tab to global
      const tabId = Riptide.Tabs.activeTabId;
      if (tabId) {
        const tab = Riptide.Tabs.getActiveTab();
        if (tab && tab.variables) {
          delete tab.variables[name];
          Riptide.Tabs.setTabVariables(tabId, tab.variables);
        }
      }
      this._globalVars[name] = value;
      await this._saveGlobalVars();
    } else {
      // Move from global to tab
      const tabId = Riptide.Tabs.activeTabId;
      if (!tabId) return;
      const tab = Riptide.Tabs.getActiveTab();
      if (!tab.variables) tab.variables = {};
      tab.variables[name] = value;
      Riptide.Tabs.setTabVariables(tabId, tab.variables);

      // Remove from global
      delete this._globalVars[name];
      await this._saveGlobalVars();

      // Also delete from server
      try {
        await Riptide.api(`/api/variables/${encodeURIComponent(name)}`, {
          method: 'DELETE'
        });
      } catch { /* ignore */ }
    }
    this.refresh();
    Riptide.Preview.updateAllVariables();
  },

  substituteCommand(command) {
    const effective = this.getEffective();
    const missing = [];

    const result = command.replace(/<([A-Za-z_][A-Za-z0-9_]*)>/g, (match, name) => {
      const value = effective[name];
      if (value === undefined || value === null || value === '') {
        missing.push(name);
        return match;
      }
      return value;
    });

    return { result, missing };
  },

  async _addManual() {
    const name = await Riptide.Modal.prompt('Variable name', '');
    if (!name) return;

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      this._toast('Invalid name — use letters, digits, underscores');
      return;
    }

    // Check if already exists in either scope
    const tabId = Riptide.Tabs.activeTabId;
    if (!tabId) return;
    const tabVars = Riptide.Tabs.getTabVariables(tabId);
    if (name in tabVars || name in this._globalVars) {
      this._toast(name + ' already exists');
      return;
    }

    // Ask for scope
    const choice = await Riptide.Modal.choose('Variable scope', null, 'Tab (this tab only)', 'Global (all tabs)');
    if (choice === null) return;
    const isGlobal = choice === 'b';

    if (isGlobal) {
      this._globalVars[name] = '';
      await this._saveGlobalVars();
    } else {
      const tab = Riptide.Tabs.getActiveTab();
      if (!tab.variables) tab.variables = {};
      tab.variables[name] = '';
      Riptide.Tabs.setTabVariables(tabId, tab.variables);
    }

    this.refresh();

    if (!this._panel.expanded) {
      this._panel.toggle();
    }

    this._toast('Added ' + name + (isGlobal ? ' (global)' : ''));
  },

  async _removeVariable(name, scope) {
    const confirmed = await Riptide.Modal.confirm(
      'Delete variable',
      `Delete "${name}"${scope === 'global' ? ' (global)' : ''}?`
    );
    if (!confirmed) return;

    if (scope === 'global') {
      delete this._globalVars[name];
      this._saveGlobalVars();
      // Also delete from server
      Riptide.api(`/api/variables/${encodeURIComponent(name)}`, {
        method: 'DELETE'
      }).catch(() => {});
    } else {
      const tabId = Riptide.Tabs.activeTabId;
      if (!tabId) return;
      const tab = Riptide.Tabs.getActiveTab();
      if (!tab.variables) return;
      delete tab.variables[name];
      Riptide.Tabs.setTabVariables(tabId, tab.variables);
    }
    this.refresh();
    Riptide.Preview.updateAllVariables();
  },

  // Called by sync when global vars change remotely
  setGlobalVars(variables) {
    this._globalVars = variables;
    this.refresh();
    Riptide.Preview.updateAllVariables();
  },

  _toast(message) {
    Riptide.toast(message);
  }
};
