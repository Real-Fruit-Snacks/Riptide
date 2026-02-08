window.Riptide = window.Riptide || {};

Riptide.Editor = {
  _instances: [], // Track active editor instances for theme refresh

  /**
   * Helper to get color from theme with fallback
   * @private
   */
  _c(token, fallback) {
    return Riptide.Theme ? Riptide.Theme.getColor(token) : fallback;
  },

  /**
   * Build theme extensions (can be rebuilt on theme change)
   * @private
   */
  _buildThemeExtensions() {
    const { EditorView, HighlightStyle, tags } = window.CM;

    const theme = EditorView.theme({
      '&': {
        color: this._c('text', '#cad3f5'),
        backgroundColor: this._c('base', '#24273a'),
        height: '100%',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        fontSize: '14px',
        lineHeight: '1.6'
      },
      '.cm-content': {
        caretColor: this._c('rosewater', '#f4dbd6'),
        padding: '8px 0'
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: this._c('rosewater', '#f4dbd6')
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: this._c('surface1', '#494d64')
      },
      '.cm-activeLine': {
        backgroundColor: this._c('mantle', '#1e2030')
      },
      '.cm-gutters': {
        backgroundColor: this._c('mantle', '#1e2030'),
        color: this._c('surface2', '#5b6078'),
        border: 'none',
        borderRight: '1px solid ' + this._c('surface0', '#363a4f')
      },
      '.cm-activeLineGutter': {
        backgroundColor: this._c('mantle', '#1e2030'),
        color: this._c('blue', '#8aadf4')
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 8px',
        minWidth: '40px'
      },
      '.cm-foldGutter': {
        width: '16px',
        padding: '0 4px'
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace"
      },
      '.cm-searchMatch': {
        backgroundColor: this._c('surface1', '#494d64'),
        outline: '1px solid ' + this._c('surface2', '#5b6078')
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: this._c('surface0', '#363a4f')
      }
    }, { dark: true });

    const highlightStyle = HighlightStyle.define([
      { tag: tags.comment, color: this._c('overlay0', '#6e738d'), fontStyle: 'italic' },
      { tag: tags.lineComment, color: this._c('overlay0', '#6e738d'), fontStyle: 'italic' },
      { tag: tags.blockComment, color: this._c('overlay0', '#6e738d'), fontStyle: 'italic' },
      { tag: tags.docComment, color: this._c('overlay0', '#6e738d'), fontStyle: 'italic' },

      { tag: tags.string, color: this._c('green', '#a6da95') },
      { tag: tags.special(tags.string), color: this._c('green', '#a6da95') },
      { tag: tags.character, color: this._c('green', '#a6da95') },

      { tag: tags.keyword, color: this._c('mauve', '#c6a0f6') },
      { tag: tags.modifier, color: this._c('mauve', '#c6a0f6') },
      { tag: tags.operator, color: this._c('teal', '#8bd5ca') },
      { tag: tags.operatorKeyword, color: this._c('mauve', '#c6a0f6') },

      { tag: tags.function(tags.variableName), color: this._c('blue', '#8aadf4') },
      { tag: tags.function(tags.propertyName), color: this._c('blue', '#8aadf4') },

      { tag: tags.number, color: this._c('peach', '#f5a97f') },
      { tag: tags.bool, color: this._c('peach', '#f5a97f') },
      { tag: tags.null, color: this._c('peach', '#f5a97f') },

      { tag: tags.variableName, color: this._c('text', '#cad3f5') },
      { tag: tags.propertyName, color: this._c('yellow', '#eed49f') },
      { tag: tags.typeName, color: this._c('yellow', '#eed49f') },
      { tag: tags.className, color: this._c('yellow', '#eed49f') },

      { tag: tags.heading, color: this._c('text', '#cad3f5'), fontWeight: 'bold' },
      { tag: tags.heading1, color: this._c('text', '#cad3f5'), fontWeight: 'bold', fontSize: '1.4em' },
      { tag: tags.heading2, color: this._c('text', '#cad3f5'), fontWeight: 'bold', fontSize: '1.3em' },
      { tag: tags.heading3, color: this._c('text', '#cad3f5'), fontWeight: 'bold', fontSize: '1.2em' },
      { tag: tags.heading4, color: this._c('text', '#cad3f5'), fontWeight: 'bold', fontSize: '1.1em' },
      { tag: tags.heading5, color: this._c('text', '#cad3f5'), fontWeight: 'bold' },
      { tag: tags.heading6, color: this._c('text', '#cad3f5'), fontWeight: 'bold' },

      { tag: tags.emphasis, color: this._c('pink', '#f5bde6'), fontStyle: 'italic' },
      { tag: tags.strong, color: this._c('rosewater', '#f4dbd6'), fontWeight: 'bold' },

      { tag: tags.link, color: this._c('blue', '#8aadf4') },
      { tag: tags.url, color: this._c('blue', '#8aadf4'), textDecoration: 'underline' },

      { tag: tags.monospace, color: this._c('red', '#ed8796') },
      { tag: tags.processingInstruction, color: this._c('red', '#ed8796') },

      { tag: tags.meta, color: this._c('overlay0', '#6e738d') },
      { tag: tags.invalid, color: this._c('red', '#ed8796'), textDecoration: 'underline wavy' }
    ]);

    return { theme, highlightStyle };
  },

  /**
   * Create a CodeMirror 6 editor instance
   * @param {HTMLElement} container - Container element
   * @param {string} content - Initial content
   * @param {Function} onChange - Callback for content changes
   * @param {Object} [options] - Optional configuration
   * @param {Function} [options.onImagePaste] - Callback for pasted images: (blob, filename) => Promise<string>
   * @returns {Object} Editor instance with view and state
   */
  create(container, content, onChange, options) {
    const {
      EditorState,
      EditorView,
      keymap,
      lineNumbers,
      highlightActiveLineGutter,
      highlightSpecialChars,
      drawSelection,
      dropCursor,
      highlightActiveLine,
      history,
      historyKeymap,
      indentWithTab,
      markdown,
      syntaxHighlighting,
      indentOnInput,
      bracketMatching,
      foldGutter,
      foldKeymap,
      searchKeymap,
      highlightSelectionMatches,
      closeBrackets,
      closeBracketsKeymap,
      defaultKeymap
    } = window.CM;

    // Get theme-aware extensions
    const { theme, highlightStyle } = this._buildThemeExtensions();

    // Custom keybindings for save and escape
    const customKeymap = keymap.of([
      {
        key: 'Ctrl-s',
        mac: 'Cmd-s',
        run: (_view) => {
          container.dispatchEvent(new CustomEvent('cm-save'));
          return true;
        }
      },
      {
        key: 'Escape',
        run: (_view) => {
          container.dispatchEvent(new CustomEvent('cm-escape'));
          return true;
        }
      }
    ]);

    // Update extension to call onChange
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString());
      }
    });

    // Create editor state
    const state = EditorState.create({
      doc: content || '',
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        markdown(),
        syntaxHighlighting(highlightStyle),
        theme,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab
        ]),
        customKeymap,
        updateListener
      ]
    });

    // Create editor view
    const view = new EditorView({
      state,
      parent: container
    });

    // Track instance for theme refresh
    const instance = { view, state, container };
    this._instances.push(instance);

    // Image paste support
    if (options && options.onImagePaste) {
      container.addEventListener('paste', async (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;

        for (const item of items) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const blob = item.getAsFile();
            if (!blob) return;

            // Generate filename
            const ext = item.type.split('/')[1] === 'jpeg' ? 'jpg' : item.type.split('/')[1] || 'png';
            const filename = 'evidence-' + Date.now() + '.' + ext;

            // Show uploading placeholder at cursor
            const cursor = view.state.selection.main.head;
            const placeholder = '![Uploading ' + filename + '...]()';
            view.dispatch({
              changes: { from: cursor, insert: placeholder }
            });

            try {
              const uploadedName = await options.onImagePaste(blob, filename);
              // Replace placeholder with actual reference
              const doc = view.state.doc.toString();
              const phIdx = doc.indexOf(placeholder);
              if (phIdx !== -1) {
                view.dispatch({
                  changes: { from: phIdx, to: phIdx + placeholder.length, insert: '![' + uploadedName + '](' + uploadedName + ')' }
                });
              }
            } catch (_err) {
              // Replace placeholder on error
              const doc = view.state.doc.toString();
              const phIdx = doc.indexOf(placeholder);
              if (phIdx !== -1) {
                view.dispatch({
                  changes: { from: phIdx, to: phIdx + placeholder.length, insert: '' }
                });
              }
            }
            return; // Only handle first image
          }
        }
      });
    }

    return instance;
  },

  /**
   * Refresh theme for all active editors
   */
  refreshTheme() {
    // CodeMirror themes are built at create() time via _buildThemeExtensions().
    // On theme switch, destroy and recreate open editors so they pick up new colors.
    for (const instance of this._instances) {
      if (instance && instance.view && instance.container) {
        try {
          const doc = instance.view.state.doc.toString();
          const parent = instance.container;
          instance.view.destroy();
          // Rebuild with fresh theme colors (create() will re-read Riptide.Theme)
          const idx = this._instances.indexOf(instance);
          const rebuilt = this.create(parent, doc, () => {});
          // Restore in the tracking array (create() pushes a new entry)
          if (idx !== -1) {
            this._instances.splice(idx, 1);
          }
          instance.view = rebuilt.view;
          instance.state = rebuilt.state;
        } catch (err) {
          console.warn('Failed to refresh editor theme:', err);
        }
      }
    }
  },

  /**
   * Destroy an editor instance
   * @param {Object} instance - Editor instance from create()
   */
  destroy(instance) {
    if (instance && instance.view) {
      instance.view.destroy();
      // Remove from instances array
      const idx = this._instances.indexOf(instance);
      if (idx !== -1) {
        this._instances.splice(idx, 1);
      }
    }
  },

  /**
   * Get current editor content
   * @param {Object} instance - Editor instance from create()
   * @returns {string} Current content
   */
  getValue(instance) {
    if (instance && instance.view) {
      return instance.view.state.doc.toString();
    }
    return '';
  },

  /**
   * Focus the editor
   * @param {Object} instance - Editor instance from create()
   */
  focus(instance) {
    if (instance && instance.view) {
      instance.view.focus();
    }
  }
};
