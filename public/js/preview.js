window.Riptide = window.Riptide || {};

Riptide.Preview = {
  _imageToken: null,
  _imageTokenExpiry: 0,
  _escEl: null,
  _dpHookRegistered: false,

  async _getImageToken() {
    if (this._imageToken && Date.now() < this._imageTokenExpiry - 30000) {
      return this._imageToken;
    }
    try {
      const data = await Riptide.api('/api/image-token');
      this._imageToken = data.token;
      this._imageTokenExpiry = Date.now() + data.expiresIn;
      return this._imageToken;
    } catch {
      return null;
    }
  },

  _refreshImageToken() {
    // Fire-and-forget token refresh for synchronous render path
    if (!this._imageToken || Date.now() >= this._imageTokenExpiry - 30000) {
      this._getImageToken().then(() => {
        document.querySelectorAll('.pb-content').forEach(c => this._rewriteImageSrc(c));
      }).catch(() => {});
    }
  },

  render(container, markdown) {
    // Ensure image token is fresh for any <img> rewrites
    this._refreshImageToken();

    // Strip YAML frontmatter (---\n...\n---) before rendering
    let md = markdown || '';
    const fmMatch = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (fmMatch) {
      md = md.slice(fmMatch[0].length);
    }

    const rawHtml = marked.parse(md, {
      breaks: true,
      gfm: true
    });

    // Register external-image-blocking hook (once)
    if (!this._dpHookRegistered) {
      DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        if (node.tagName === 'IMG') {
          const src = node.getAttribute('src') || '';
          if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
            node.removeAttribute('src');
          }
        }
      });
      this._dpHookRegistered = true;
    }

    container.innerHTML = DOMPurify.sanitize(rawHtml, {
      ADD_TAGS: ['code', 'input', 'img'],
      ADD_ATTR: ['class', 'checked', 'disabled', 'type', 'src', 'alt', 'width', 'height', 'loading']
    });

    // Secure external links
    container.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('http://') || href.startsWith('https://')) {
        a.setAttribute('rel', 'noopener noreferrer');
        a.setAttribute('target', '_blank');
      }
    });

    this._applySyntaxHighlighting(container);
    this.injectButtons(container);
    this._injectCheckboxes(container);
    this._rewriteImageSrc(container);
  },

  injectButtons(container) {
    const codeBlocks = container.querySelectorAll('pre code');

    codeBlocks.forEach((codeEl) => {
      const preEl = codeEl.parentElement;
      const lang = codeEl.className || '';
      const isBash = /language-(bash|sh|shell|zsh)/.test(lang);
      const isConfirmBash = /language-(bash|sh|shell|zsh):confirm/.test(lang);

      preEl.style.position = 'relative';

      // Click-to-copy on the code block
      preEl.classList.add('copyable-code');
      preEl.title = 'Click to copy';
      preEl.addEventListener('click', (e) => {
        // Don't copy if clicking a button
        if (e.target.closest('button')) return;

        const text = codeEl.dataset.originalCmd || codeEl.textContent;
        Riptide.clipboard(text);
        preEl.classList.add('code-copied');
        setTimeout(() => preEl.classList.remove('code-copied'), 1000);
      });

      // Style captured output blocks (```output)
      if (/language-output/.test(lang)) {
        preEl.classList.add('captured-output-pre');
        this._addDeleteOutputBtn(preEl);
        // Analyze previously captured output for findings
        if (Riptide.OutputParser) {
          const rawText = codeEl.textContent;
          Riptide.OutputParser.analyze(preEl, rawText);
        }
        return;
      }

      if (isBash || isConfirmBash) {
        const command = codeEl.textContent.trim();

        codeEl.dataset.originalCmd = command;
        codeEl.innerHTML = this._highlightVariables(command);

        // Add warning badge for confirm blocks
        if (isConfirmBash) {
          preEl.classList.add('confirm-block');
          const badge = document.createElement('span');
          badge.className = 'confirm-badge';
          badge.textContent = '\u26a0 Confirm';
          preEl.appendChild(badge);
        }

        const runBtn = document.createElement('button');
        runBtn.className = 'run-command-btn' + (isConfirmBash ? ' run-confirm-btn' : '');
        runBtn.textContent = isConfirmBash ? '\u26a0 Run' : '\u25b6 Run';
        runBtn.title = isConfirmBash
          ? 'Execute with confirmation (dangerous command)'
          : 'Execute this command in the terminal';

        runBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const { result, missing } = Riptide.Variables.substituteCommand(command);
          if (missing.length > 0) {
            Riptide.toast('Missing: ' + missing.join(', '));
            return;
          }

          // Confirm before running if this is a confirm block
          if (isConfirmBash) {
            const confirmed = await Riptide.Modal.confirm(
              'Confirm Execution',
              'This command is marked as requiring confirmation:\n\n' + result,
              'Execute'
            );
            if (!confirmed) return;
          }

          const activeTabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;

          const sectionEl = preEl.closest('.pb-section');
          const auditNoteId = sectionEl ? sectionEl.dataset.noteId : null;
          const auditSection = auditNoteId ? Riptide.Playbooks.sections.get(auditNoteId) : null;
          Riptide.Terminal.sendCommand(result, {
            type: 'run',
            playbookTitle: auditSection ? auditSection.title : '',
            noteId: auditNoteId || ''
          });

          // Log to command history
          if (activeTabId && Riptide.History) {
            Riptide.History.log(activeTabId, result);
          }

          // Inject clipboard-based capture button on this code block
          this._injectCaptureBtn(preEl);

          runBtn.textContent = '\u2713 Sent';
          runBtn.style.background = Riptide.Theme ? Riptide.Theme.getColor('teal') : '#8bd5ca';
          setTimeout(() => {
            runBtn.textContent = isConfirmBash ? '\u26a0 Run' : '\u25b6 Run';
            runBtn.style.background = '';
          }, 1500);
        });

        preEl.appendChild(runBtn);
      }
    });
  },

  _injectCheckboxes(container) {
    const checkboxes = container.querySelectorAll('li > input[type="checkbox"]');
    checkboxes.forEach((cb, index) => {
      cb.disabled = false;
      cb.classList.add('checklist-cb');

      const li = cb.parentElement;
      if (li) {
        li.classList.add('checklist-item');
        if (cb.checked) li.classList.add('checklist-done');
      }

      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const isChecked = cb.checked;

        if (li) {
          if (isChecked) {
            li.classList.add('checklist-done');
          } else {
            li.classList.remove('checklist-done');
          }
        }

        this._toggleCheckboxInMarkdown(container, index, isChecked);
      });
    });
  },

  _toggleCheckboxInMarkdown(container, checkboxIndex, isChecked) {
    const sectionEl = container.closest('.pb-section');
    if (!sectionEl) return;
    const noteId = sectionEl.dataset.noteId;
    if (!noteId) return;

    const section = Riptide.Playbooks.sections.get(noteId);
    if (!section || section.content === null) return;

    const checkboxRegex = /^(\s*[-*+]\s+)\[([ xX])\]/gm;
    const md = section.content;
    let match;
    let count = 0;
    let targetMatch = null;

    while ((match = checkboxRegex.exec(md)) !== null) {
      if (count === checkboxIndex) {
        targetMatch = match;
        break;
      }
      count++;
    }

    if (!targetMatch) return;

    const before = md.substring(0, targetMatch.index);
    const after = md.substring(targetMatch.index + targetMatch[0].length);
    const prefix = targetMatch[1];
    const newCheck = isChecked ? '[x]' : '[ ]';
    section.content = before + prefix + newCheck + after;

    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (tabId) {
      Riptide.Notes.save(tabId, noteId, section.content).catch(err => {
        console.error('Failed to save checkbox toggle:', err);
        Riptide.toast('Failed to save checkbox state');
      });
    }
  },

  _applySyntaxHighlighting(container) {
    if (typeof Prism === 'undefined') return;

    container.querySelectorAll('pre code').forEach((codeEl) => {
      // Skip bash blocks — handled by injectButtons + _highlightVariables
      if (/language-(bash|sh|shell|zsh)/.test(codeEl.className || '')) return;

      const langName = this._getLang(codeEl);
      if (langName && Prism.languages[langName]) {
        codeEl.innerHTML = Prism.highlight(
          codeEl.textContent,
          Prism.languages[langName],
          langName
        );
      }
    });
  },

  _getLang(codeEl) {
    const match = (codeEl.className || '').match(/language-(\w+)/);
    if (!match) return null;
    const lang = match[1];
    if (lang === 'zsh') return 'bash';
    return lang;
  },

  getCommands(container) {
    const commands = [];
    container.querySelectorAll('pre code[data-original-cmd]').forEach((codeEl) => {
      commands.push({
        raw: codeEl.dataset.originalCmd,
        preEl: codeEl.parentElement
      });
    });
    return commands;
  },

  updateAllVariables() {
    const stack = document.getElementById('playbook-stack');
    if (!stack) return;
    stack.querySelectorAll('pre code[data-original-cmd]').forEach((codeEl) => {
      codeEl.innerHTML = this._highlightVariables(codeEl.dataset.originalCmd);
    });
  },

  _highlightVariables(originalText) {
    const stored = Riptide.Variables.getEffective();
    const varRegex = /<([A-Za-z_][A-Za-z0-9_]*)>/g;

    // Replace <VarName> with unique placeholders before Prism processes the text
    const placeholders = new Map();
    let idx = 0;
    const withPlaceholders = originalText.replace(varRegex, (_match, varName) => {
      const ph = 'CWVAR' + idx + 'PH';
      placeholders.set(ph, varName);
      idx++;
      return ph;
    });

    // Apply Prism syntax highlighting
    let highlighted;
    if (typeof Prism !== 'undefined' && Prism.languages.bash) {
      highlighted = Prism.highlight(withPlaceholders, Prism.languages.bash, 'bash');
    } else {
      highlighted = this._escHtml(withPlaceholders);
    }

    // Replace placeholders with variable highlight spans
    for (const [ph, varName] of placeholders) {
      const value = stored[varName];
      let replacement;
      if (value !== undefined && value !== null) {
        replacement = '<span class="var-substituted" title="' + varName + '">' + this._escHtml(value) + '</span>';
      } else {
        replacement = '<span class="var-unset">&lt;' + this._escHtml(varName) + '&gt;</span>';
      }
      // Placeholder might be inside a Prism span — split/join handles it cleanly
      highlighted = highlighted.split(ph).join(replacement);
    }

    return highlighted;
  },

  _injectCaptureBtn(preEl) {
    // Remove any existing capture button on this block
    const existing = preEl.querySelector('.capture-output-btn');
    if (existing) existing.remove();

    const capBtn = document.createElement('button');
    capBtn.className = 'capture-output-btn';
    capBtn.textContent = '\u2318 Paste Capture';
    capBtn.title = 'Paste clipboard contents as captured output';

    capBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        const output = await navigator.clipboard.readText();
        if (!output || !output.trim()) {
          Riptide.toast('Clipboard is empty \u2014 copy terminal output first');
          return;
        }
        this._insertOutputBlock(preEl, output.trim());
        capBtn.remove();
      } catch {
        // Clipboard API denied — show fallback prompt
        const output = await Riptide.Modal.prompt('Paste captured output');
        if (output && output.trim()) {
          this._insertOutputBlock(preEl, output.trim());
          capBtn.remove();
        }
      }
    });

    preEl.appendChild(capBtn);
  },

  _insertOutputBlock(preEl, output) {
    // Remove any previous output block for this command
    const next = preEl.nextElementSibling;
    if (next && next.classList.contains('captured-output-pre')) {
      next.remove();
    }

    const pre = document.createElement('pre');
    pre.className = 'captured-output-pre copyable-code';
    pre.style.position = 'relative';
    pre.title = 'Click to copy';

    const code = document.createElement('code');
    code.textContent = output;
    pre.appendChild(code);

    // Click-to-copy on the output block
    pre.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      Riptide.clipboard(output);
      pre.classList.add('code-copied');
      setTimeout(() => pre.classList.remove('code-copied'), 1000);
    });

    // Add delete button to the output block
    this._addDeleteOutputBtn(pre);

    // Insert right after the command's <pre> element
    preEl.insertAdjacentElement('afterend', pre);

    // Analyze output for findings (IPs, hashes, credentials, etc.)
    if (Riptide.OutputParser) {
      Riptide.OutputParser.analyze(pre, output);
    }

    // Persist to note markdown so it syncs and survives re-renders
    this._persistCapturedOutput(preEl, output);
  },

  _addDeleteOutputBtn(outputPreEl) {
    const btn = document.createElement('button');
    btn.className = 'delete-output-btn';
    btn.textContent = '\u00d7 Delete';
    btn.title = 'Delete captured output';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Remove from markdown before removing from DOM
      this._removeOutputFromMarkdown(outputPreEl);

      // Remove findings toolbar if present
      const findingsBar = outputPreEl.previousElementSibling;
      if (findingsBar && findingsBar.classList.contains('output-findings')) {
        findingsBar.remove();
      }

      outputPreEl.remove();
    });

    outputPreEl.appendChild(btn);
  },

  _removeOutputFromMarkdown(outputPreEl) {
    // Find the bash code block directly above this output block
    const bashPre = outputPreEl.previousElementSibling;
    if (!bashPre) return;

    const sectionEl = outputPreEl.closest('.pb-section');
    if (!sectionEl) return;
    const noteId = sectionEl.dataset.noteId;
    if (!noteId) return;

    const section = Riptide.Playbooks.sections.get(noteId);
    if (!section || section.content === null) return;

    // Determine which bash code block this is (by DOM index)
    const contentDiv = sectionEl.querySelector('.pb-content');
    if (!contentDiv) return;
    const allBashCodes = contentDiv.querySelectorAll('pre code[data-original-cmd]');
    let blockIndex = -1;
    for (let i = 0; i < allBashCodes.length; i++) {
      if (allBashCodes[i].parentElement === bashPre) {
        blockIndex = i;
        break;
      }
    }
    if (blockIndex === -1) return;

    // Find the Nth bash fenced code block in the markdown
    const md = section.content;
    const fenceRegex = /```(?:bash|sh|shell|zsh)\s*\n[\s\S]*?```/g;
    let match;
    let count = 0;
    let fenceEnd = -1;
    while ((match = fenceRegex.exec(md)) !== null) {
      if (count === blockIndex) {
        fenceEnd = match.index + match[0].length;
        break;
      }
      count++;
    }
    if (fenceEnd === -1) return;

    // Check if there's an ```output block right after this bash block
    const afterBash = md.substring(fenceEnd);
    const outputMatch = afterBash.match(/^\s*\n```output\n[\s\S]*?\n```/);
    if (!outputMatch) return;

    // Remove the output block from markdown
    section.content = md.substring(0, fenceEnd) + md.substring(fenceEnd + outputMatch[0].length);

    // Save to server
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (tabId) {
      Riptide.Notes.save(tabId, noteId, section.content).catch(err => {
        console.error('Failed to save after output deletion:', err);
      });
    }
  },

  _persistCapturedOutput(preEl, output) {
    // Find the section this code block belongs to
    const sectionEl = preEl.closest('.pb-section');
    if (!sectionEl) return;
    const noteId = sectionEl.dataset.noteId;
    if (!noteId) return;

    const section = Riptide.Playbooks.sections.get(noteId);
    if (!section || section.content === null) return;

    // Determine which bash code block this is (by DOM index)
    const contentDiv = sectionEl.querySelector('.pb-content');
    if (!contentDiv) return;
    const allBashCodes = contentDiv.querySelectorAll('pre code[data-original-cmd]');
    let blockIndex = -1;
    for (let i = 0; i < allBashCodes.length; i++) {
      if (allBashCodes[i].parentElement === preEl) {
        blockIndex = i;
        break;
      }
    }
    if (blockIndex === -1) return;

    // Find the Nth bash fenced code block in the markdown
    const md = section.content;
    const fenceRegex = /```(?:bash|sh|shell|zsh)\s*\n[\s\S]*?```/g;
    let match;
    let count = 0;
    let insertPos = -1;
    while ((match = fenceRegex.exec(md)) !== null) {
      if (count === blockIndex) {
        insertPos = match.index + match[0].length;
        break;
      }
      count++;
    }
    if (insertPos === -1) return;

    // Check if there's already a ```output block right after this bash block
    const afterBash = md.substring(insertPos);
    const existingMatch = afterBash.match(/^\s*\n```output\n[\s\S]*?\n```/);
    const outputBlock = '\n\n```output\n' + output + '\n```';

    if (existingMatch) {
      // Replace existing captured output
      section.content = md.substring(0, insertPos) + outputBlock +
        md.substring(insertPos + existingMatch[0].length);
    } else {
      // Insert new captured output after the bash block
      section.content = md.substring(0, insertPos) + outputBlock +
        md.substring(insertPos);
    }

    // Save to server (broadcasts note-updated to other clients)
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    if (tabId) {
      Riptide.Notes.save(tabId, noteId, section.content).catch(err => {
        console.error('Failed to save captured output:', err);
      });
    }
  },

  _escHtml(text) {
    if (!this._escEl) this._escEl = document.createElement('div');
    this._escEl.textContent = text || '';
    return this._escEl.innerHTML;
  },

  _rewriteImageSrc(container) {
    const tabId = Riptide.Tabs ? Riptide.Tabs.activeTabId : null;
    const token = this._imageToken;
    if (!tabId || !token) return;

    container.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src');
      if (!src) return;
      // Skip absolute URLs, data URIs, and already-rewritten URLs
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:') || src.startsWith('/api/')) return;

      // Rewrite relative filename to short-lived image token URL
      const filename = encodeURIComponent(src);
      img.src = '/api/tabs/' + encodeURIComponent(tabId) + '/files/' + filename + '?token=' + encodeURIComponent(token);
      img.loading = 'lazy';

      // Add click-to-zoom
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => {
        this._showImageLightbox(img.src, img.alt);
      });
    });
  },

  _showImageLightbox(src, alt) {
    const overlay = document.createElement('div');
    overlay.className = 'evidence-lightbox';

    const img = document.createElement('img');
    img.src = src;
    img.alt = alt || 'Evidence';

    const closeLightbox = () => {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    };

    const closeBtn = document.createElement('button');
    closeBtn.className = 'evidence-lightbox-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', closeLightbox);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeLightbox();
    });

    // ESC to close
    const escHandler = (e) => {
      if (e.key === 'Escape') closeLightbox();
    };
    document.addEventListener('keydown', escHandler);

    overlay.appendChild(img);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);
  }
};
