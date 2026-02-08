window.Riptide = window.Riptide || {};

Riptide.Search = {
  _bar: null,
  _input: null,
  _countEl: null,
  _matches: [],
  _currentIndex: -1,
  _debounceTimeout: null,
  _affectedSections: new Set(),
  _isOpen: false,
  _searchGeneration: 0,

  init() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();

        // Don't open if editor popup is open
        if (document.querySelector('.pb-editor-overlay')) return;

        // Don't open if modal is open
        if (!document.getElementById('modal-overlay').classList.contains('hidden')) return;

        if (this._isOpen) {
          // Already open, just focus
          this._input.focus();
          this._input.select();
        } else {
          this.open();
        }
      }
    });
  },

  open() {
    if (this._isOpen) return;

    this._buildSearchBar();
    this._isOpen = true;

    const leftPanel = document.getElementById('left-panel');
    leftPanel.insertBefore(this._bar, leftPanel.firstChild);

    this._input.focus();
  },

  close() {
    if (!this._isOpen) return;

    this._clearHighlights();

    if (this._bar && this._bar.parentElement) {
      this._bar.remove();
    }

    this._matches = [];
    this._currentIndex = -1;
    this._isOpen = false;
  },

  _buildSearchBar() {
    const bar = document.createElement('div');
    bar.className = 'pb-search-bar';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pb-search-input';
    input.placeholder = 'Search playbooks...';
    input.spellcheck = false;

    const count = document.createElement('span');
    count.className = 'pb-search-count';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'pb-search-prev';
    prevBtn.innerHTML = '&#9650;';
    prevBtn.title = 'Previous match (Shift+Enter)';

    const nextBtn = document.createElement('button');
    nextBtn.className = 'pb-search-next';
    nextBtn.innerHTML = '&#9660;';
    nextBtn.title = 'Next match (Enter)';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pb-search-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close search (Esc)';

    bar.appendChild(input);
    bar.appendChild(count);
    bar.appendChild(prevBtn);
    bar.appendChild(nextBtn);
    bar.appendChild(closeBtn);

    // Event listeners
    input.addEventListener('input', () => {
      clearTimeout(this._debounceTimeout);
      this._debounceTimeout = setTimeout(() => {
        const query = input.value.trim();
        if (query) {
          this._performSearch(query);
        } else {
          this._clearHighlights();
          this._matches = [];
          this._currentIndex = -1;
          this._updateCount();
        }
      }, 150);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this._navigatePrev();
        } else {
          this._navigateNext();
        }
      }
    });

    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this._navigatePrev();
    });

    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this._navigateNext();
    });

    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.close();
    });

    this._bar = bar;
    this._input = input;
    this._countEl = count;
  },

  async _performSearch(query) {
    this._clearHighlights();
    this._matches = [];
    this._currentIndex = -1;

    // Increment generation counter and capture it for this search
    this._searchGeneration++;
    const gen = this._searchGeneration;

    const lowerQuery = query.toLowerCase();
    const expandPromises = [];

    for (const [noteId, section] of Riptide.Playbooks.sections) {
      if (section.expanded && section.content !== null) {
        // Search in visible rendered content
        const contentDiv = section.el.querySelector('.pb-content');
        if (contentDiv) {
          this._highlightInElement(contentDiv, lowerQuery, noteId);
        }
      } else if (section.content !== null) {
        // Search in raw markdown for collapsed sections
        const contentLower = section.content.toLowerCase();
        if (contentLower.includes(lowerQuery)) {
          // Expand the section and then search
          expandPromises.push(
            Riptide.Playbooks._expandSection(noteId).then(() => {
              // Discard if a newer search has started
              if (gen !== this._searchGeneration) return;

              const contentDiv = section.el.querySelector('.pb-content');
              if (contentDiv) {
                this._highlightInElement(contentDiv, lowerQuery, noteId);
              }
            })
          );
        }
      }
    }

    // Wait for all expansions to complete before updating count
    if (expandPromises.length > 0) {
      await Promise.all(expandPromises);
      // Discard if a newer search has started
      if (gen !== this._searchGeneration) return;
    }

    this._updateCount();

    if (this._matches.length > 0) {
      this._currentIndex = 0;
      this._matches[0].classList.add('pb-search-highlight-active');
      this._scrollToMatch(0);
    }
  },

  _highlightInElement(element, lowerQuery, noteId) {
    let matchCount = 0;
    this._affectedSections.add(noteId);

    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip text nodes inside buttons or script/style elements
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const tag = parent.tagName.toLowerCase();
          if (tag === 'button' || tag === 'script' || tag === 'style') {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip if already inside a highlight mark
          if (parent.classList.contains('pb-search-highlight')) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    // Process text nodes and insert marks
    for (const textNode of textNodes) {
      const text = textNode.textContent;
      const lowerText = text.toLowerCase();

      let startIndex = 0;
      const fragments = [];
      let lastIndex = 0;

      while ((startIndex = lowerText.indexOf(lowerQuery, lastIndex)) !== -1) {
        // Add text before match
        if (startIndex > lastIndex) {
          fragments.push(document.createTextNode(text.substring(lastIndex, startIndex)));
        }

        // Add highlighted match
        const mark = document.createElement('mark');
        mark.className = 'pb-search-highlight';
        mark.textContent = text.substring(startIndex, startIndex + lowerQuery.length);
        fragments.push(mark);
        this._matches.push(mark);
        matchCount++;

        lastIndex = startIndex + lowerQuery.length;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        fragments.push(document.createTextNode(text.substring(lastIndex)));
      }

      // Replace the text node with fragments if we found matches
      if (fragments.length > 0) {
        const parent = textNode.parentNode;
        for (const fragment of fragments) {
          parent.insertBefore(fragment, textNode);
        }
        parent.removeChild(textNode);
      }
    }

    return matchCount;
  },

  _clearHighlights() {
    // Re-render affected sections to restore clean state
    for (const noteId of this._affectedSections) {
      const section = Riptide.Playbooks.sections.get(noteId);
      if (section && section.expanded && section.content !== null) {
        const contentDiv = section.el.querySelector('.pb-content');
        if (contentDiv) {
          Riptide.Preview.render(contentDiv, section.content);
        }
      }
    }

    this._matches = [];
    this._affectedSections.clear();
  },

  _navigateNext() {
    if (this._matches.length === 0) return;

    // Remove active class from current
    if (this._currentIndex >= 0 && this._currentIndex < this._matches.length) {
      this._matches[this._currentIndex].classList.remove('pb-search-highlight-active');
    }

    // Move to next (wrap around)
    this._currentIndex = (this._currentIndex + 1) % this._matches.length;
    this._matches[this._currentIndex].classList.add('pb-search-highlight-active');
    this._scrollToMatch(this._currentIndex);
    this._updateCount();
  },

  _navigatePrev() {
    if (this._matches.length === 0) return;

    // Remove active class from current
    if (this._currentIndex >= 0 && this._currentIndex < this._matches.length) {
      this._matches[this._currentIndex].classList.remove('pb-search-highlight-active');
    }

    // Move to previous (wrap around)
    this._currentIndex = this._currentIndex - 1;
    if (this._currentIndex < 0) {
      this._currentIndex = this._matches.length - 1;
    }
    this._matches[this._currentIndex].classList.add('pb-search-highlight-active');
    this._scrollToMatch(this._currentIndex);
    this._updateCount();
  },

  _scrollToMatch(index) {
    if (index < 0 || index >= this._matches.length) return;

    const mark = this._matches[index];
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  _updateCount() {
    if (this._matches.length === 0) {
      this._countEl.textContent = '';
    } else {
      this._countEl.textContent = `${this._currentIndex + 1} of ${this._matches.length}`;
    }
  }
};
