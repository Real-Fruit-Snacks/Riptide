window.Riptide = window.Riptide || {};

Riptide.Shortcuts = {
  _focusedSectionId: null,

  init() {
    // Track which playbook section was last clicked
    document.getElementById('playbook-stack').addEventListener('click', (e) => {
      const section = e.target.closest('.pb-section');
      if (section) {
        this._focusedSectionId = section.dataset.noteId;
      }
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Escape always works (for focusing terminal or closing modals)
      if (e.key === 'Escape') {
        if (this._isModalOpen() || this._isEditorOpen()) {
          return; // Let modal/editor handle it
        }
        this._focusTerminal();
        return;
      }

      // Check if we should block other shortcuts
      if (this._isModalOpen() || this._isEditorOpen()) {
        return; // Modal or editor is open — don't intercept
      }

      if (this._isInputFocused()) {
        return;
      }

      // Ctrl+Enter — Run focused code block
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        this._runFocusedBlock();
        return;
      }

      // Ctrl+T — New tab
      if (e.ctrlKey && !e.shiftKey && e.key === 't') {
        e.preventDefault();
        this._newTab();
        return;
      }

      // Ctrl+N — New playbook
      if (e.ctrlKey && !e.shiftKey && e.key === 'n') {
        e.preventDefault();
        this._newPlaybook();
        return;
      }

      // Ctrl+Shift+N — New playbook (alias)
      if (e.ctrlKey && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        this._newPlaybook();
        return;
      }

      // Ctrl+K — Focus library search
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        this._focusSearch();
        return;
      }

      // ? — Show shortcut reference
      if (e.key === '?') {
        e.preventDefault();
        this.showReference();
        return;
      }
    });
  },

  _isInputFocused() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || active.isContentEditable;
  },

  _isModalOpen() {
    const overlay = document.getElementById('modal-overlay');
    return overlay && !overlay.classList.contains('hidden');
  },

  _isEditorOpen() {
    return !!document.querySelector('.pb-editor-overlay');
  },

  _runFocusedBlock() {
    // Find the focused section
    if (!this._focusedSectionId) {
      Riptide.toast('No command block in focus');
      return;
    }

    const section = Riptide.Playbooks.sections.get(this._focusedSectionId);
    if (!section) {
      Riptide.toast('No command block in focus');
      return;
    }

    // Expand the section if collapsed
    if (!section.expanded) {
      Riptide.Playbooks._expandSection(this._focusedSectionId).then(() => {
        this._runFirstCommand();
      });
    } else {
      this._runFirstCommand();
    }
  },

  _runFirstCommand() {
    const section = Riptide.Playbooks.sections.get(this._focusedSectionId);
    if (!section) return;

    const contentDiv = section.el.querySelector('.pb-content');
    if (!contentDiv) return;

    const commands = Riptide.Preview.getCommands(contentDiv);
    if (commands.length === 0) {
      Riptide.toast('No bash commands in this playbook');
      return;
    }

    // Get the first command
    const cmd = commands[0];
    const { result, missing } = Riptide.Variables.substituteCommand(cmd.raw);

    if (missing.length > 0) {
      Riptide.toast('Missing: ' + missing.join(', '));
      return;
    }

    // Send and log
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;

    Riptide.Terminal.sendCommand(result);

    if (tabId && Riptide.History) {
      Riptide.History.log(tabId, result);
    }

    // Inject clipboard-based capture button
    Riptide.Preview._injectCaptureBtn(cmd.preEl);

    Riptide.toast('Command sent');
  },

  _focusTerminal() {
    const tabId = Riptide.Terminal.activeTabId;
    if (!tabId) return;

    const instance = Riptide.Terminal._getActiveSubTab(tabId);
    if (instance && instance.term) {
      instance.term.focus();
    }
  },

  _focusSearch() {
    const searchInput = document.getElementById('playbook-search');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  },

  _newPlaybook() {
    Riptide.Playbooks.addPlaybook();
  },

  _newTab() {
    if (Riptide.App && Riptide.App._createTab) {
      Riptide.App._createTab();
    }
  },

  showReference() {
    const html = `
      <table class="shortcuts-ref">
        <thead>
          <tr>
            <th>Shortcut</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><kbd>Ctrl+Enter</kbd></td>
            <td>Run focused code block</td>
          </tr>
          <tr>
            <td><kbd>Ctrl+N</kbd></td>
            <td>New playbook</td>
          </tr>
          <tr>
            <td><kbd>Ctrl+T</kbd></td>
            <td>New tab</td>
          </tr>
          <tr>
            <td><kbd>Ctrl+K</kbd></td>
            <td>Focus library search</td>
          </tr>
          <tr>
            <td><kbd>Ctrl+F</kbd></td>
            <td>Search playbooks</td>
          </tr>
          <tr>
            <td><kbd>Escape</kbd></td>
            <td>Focus terminal</td>
          </tr>
          <tr>
            <td><kbd>Ctrl+S</kbd></td>
            <td>Save current editor</td>
          </tr>
          <tr>
            <td><kbd>?</kbd></td>
            <td>This reference</td>
          </tr>
        </tbody>
      </table>
    `;

    Riptide.Modal.info('Keyboard Shortcuts', html);
  }
};
