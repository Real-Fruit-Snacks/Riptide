window.Riptide = window.Riptide || {};

Riptide.Modal = {
  _overlay: null,
  _box: null,
  _pendingResolve: null,

  init() {
    this._overlay = document.getElementById('modal-overlay');
    this._box = document.getElementById('modal-box');

    // Close on overlay click (outside the box)
    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) {
        if (this._pendingResolve) {
          this._pendingResolve(null);
          this._pendingResolve = null;
        }
        this._hide();
      }
    });
  },

  _resolveExisting() {
    if (this._pendingResolve) {
      this._pendingResolve(null);
      this._pendingResolve = null;
    }
  },

  // Returns a Promise that resolves with the trimmed input string, or null if cancelled
  prompt(title, defaultValue) {
    return new Promise((resolve) => {
      this._resolveExisting();
      this._pendingResolve = resolve;


      this._box.innerHTML = `
        <button class="modal-close-btn">&times;</button>
        <div class="modal-title">${this._esc(title)}</div>
        <input type="text" class="modal-input" value="${this._esc(defaultValue || '')}" spellcheck="false" />
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel">Cancel</button>
          <button class="modal-btn modal-btn-ok">OK</button>
        </div>
      `;

      const input = this._box.querySelector('.modal-input');
      const okBtn = this._box.querySelector('.modal-btn-ok');
      const cancelBtn = this._box.querySelector('.modal-btn-cancel');
      const closeBtn = this._box.querySelector('.modal-close-btn');

      okBtn.addEventListener('click', () => {
        const val = input.value.trim();
        this._hide();
        resolve(val || null);
      });

      cancelBtn.addEventListener('click', () => {
        this._hide();
        resolve(null);
      });

      closeBtn.addEventListener('click', () => {
        this._hide();
        resolve(null);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const val = input.value.trim();
          this._hide();
          resolve(val || null);
        }
        if (e.key === 'Escape') {
          this._hide();
          resolve(null);
        }
      });

      this._show();
      input.select();
    });
  },

  // Returns a Promise that resolves with true (confirmed) or false (cancelled)
  confirm(title, message, confirmText) {
    return new Promise((resolve) => {
      this._resolveExisting();
      this._pendingResolve = resolve;

      const btnText = confirmText || 'Delete';

      this._box.innerHTML = `
        <button class="modal-close-btn">&times;</button>
        <div class="modal-title">${this._esc(title)}</div>
        ${message ? `<div class="modal-message">${this._esc(message)}</div>` : ''}
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel">Cancel</button>
          <button class="modal-btn modal-btn-danger">${this._esc(btnText)}</button>
        </div>
      `;

      const okBtn = this._box.querySelector('.modal-btn-danger');
      const cancelBtn = this._box.querySelector('.modal-btn-cancel');
      const closeBtn = this._box.querySelector('.modal-close-btn');

      okBtn.addEventListener('click', () => {
        this._hide();
        resolve(true);
      });

      cancelBtn.addEventListener('click', () => {
        this._hide();
        resolve(false);
      });

      closeBtn.addEventListener('click', () => {
        this._hide();
        resolve(false);
      });

      this._show();
      okBtn.focus();
    });
  },

  // Shows two equal-weight options; returns 'a' for first button, 'b' for second, null if dismissed
  choose(title, message, btnALabel, btnBLabel) {
    return new Promise((resolve) => {
      this._resolveExisting();
      this._pendingResolve = resolve;


      this._box.innerHTML = `
        <button class="modal-close-btn">&times;</button>
        <div class="modal-title">${this._esc(title)}</div>
        ${message ? `<div class="modal-message">${this._esc(message)}</div>` : ''}
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel">${this._esc(btnALabel)}</button>
          <button class="modal-btn modal-btn-ok">${this._esc(btnBLabel)}</button>
        </div>
      `;

      const btnA = this._box.querySelector('.modal-btn-cancel');
      const btnB = this._box.querySelector('.modal-btn-ok');
      const closeBtn = this._box.querySelector('.modal-close-btn');

      btnA.addEventListener('click', () => {
        this._hide();
        resolve('a');
      });

      btnB.addEventListener('click', () => {
        this._hide();
        resolve('b');
      });

      closeBtn.addEventListener('click', () => {
        this._hide();
        resolve(null);
      });

      this._show();
      btnB.focus();
    });
  },

  // Shows a brief error/info message
  alert(title, message) {
    return new Promise((resolve) => {
      this._resolveExisting();
      this._pendingResolve = resolve;


      this._box.innerHTML = `
        <button class="modal-close-btn">&times;</button>
        <div class="modal-title">${this._esc(title)}</div>
        ${message ? `<div class="modal-message">${this._esc(message)}</div>` : ''}
        <div class="modal-actions">
          <button class="modal-btn modal-btn-ok">OK</button>
        </div>
      `;

      const okBtn = this._box.querySelector('.modal-btn-ok');
      const closeBtn = this._box.querySelector('.modal-close-btn');

      okBtn.addEventListener('click', () => {
        this._hide();
        resolve();
      });

      closeBtn.addEventListener('click', () => {
        this._hide();
        resolve();
      });

      this._show();
      okBtn.focus();
    });
  },

  // Like alert, but body is pre-built HTML (not escaped)
  info(title, html) {
    return new Promise((resolve) => {
      this._resolveExisting();
      this._pendingResolve = resolve;


      this._box.innerHTML = `
        <button class="modal-close-btn">&times;</button>
        <div class="modal-title">${this._esc(title)}</div>
        <div class="modal-body">${DOMPurify.sanitize(html)}</div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-ok">Got it</button>
        </div>
      `;

      const okBtn = this._box.querySelector('.modal-btn-ok');
      const closeBtn = this._box.querySelector('.modal-close-btn');

      okBtn.addEventListener('click', () => {
        this._hide();
        resolve();
      });

      closeBtn.addEventListener('click', () => {
        this._hide();
        resolve();
      });

      this._show();
      okBtn.focus();
    });
  },

  // Returns a Promise that resolves with the selected item's value, or null if cancelled
  // items is an array of { label, value } objects
  pick(title, items) {
    return new Promise((resolve) => {
      this._resolveExisting();
      this._pendingResolve = resolve;


      const itemsHTML = items
        .map(
          (item) =>
            `<div class="modal-pick-item" data-value="${this._esc(item.value)}">${this._esc(item.label)}</div>`
        )
        .join('');

      this._box.innerHTML = `
        <button class="modal-close-btn">&times;</button>
        <div class="modal-title">${this._esc(title)}</div>
        <div class="modal-pick-list">${itemsHTML}</div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel">Cancel</button>
        </div>
      `;

      const pickItems = this._box.querySelectorAll('.modal-pick-item');
      const cancelBtn = this._box.querySelector('.modal-btn-cancel');
      const closeBtn = this._box.querySelector('.modal-close-btn');

      pickItems.forEach((item) => {
        item.addEventListener('click', () => {
          const value = item.getAttribute('data-value');
          this._hide();
          resolve(value);
        });
      });

      cancelBtn.addEventListener('click', () => {
        this._hide();
        resolve(null);
      });

      closeBtn.addEventListener('click', () => {
        this._hide();
        resolve(null);
      });

      this._show();
      cancelBtn.focus();
    });
  },

  _show() {
    this._overlay.classList.remove('hidden');
    // Trigger entrance animation on next frame
    requestAnimationFrame(() => {
      this._overlay.classList.add('modal-visible');
    });
    // Listen for Escape globally while open
    this._escHandler = (e) => {
      if (e.key === 'Escape') {
        const resolve = this._pendingResolve;
        this._hide();
        if (resolve) resolve(null);
      }
    };
    document.addEventListener('keydown', this._escHandler);
  },

  _hide() {
    this._pendingResolve = null;
    this._overlay.classList.remove('modal-visible');
    const onEnd = () => {
      this._overlay.classList.add('hidden');
      this._overlay.removeEventListener('transitionend', onEnd);
    };
    this._overlay.addEventListener('transitionend', onEnd);
    // Fallback in case transitionend doesn't fire
    setTimeout(() => {
      this._overlay.removeEventListener('transitionend', onEnd);
      this._overlay.classList.add('hidden');
    }, 300);
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  },

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
