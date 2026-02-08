window.Riptide = window.Riptide || {};

Riptide.Theme = {
  _current: 'macchiato',

  init() {
    // Read theme from localStorage, default to macchiato
    const stored = localStorage.getItem('cw_theme');
    const flavor = stored || 'macchiato';
    this.apply(flavor);
  },

  apply(flavor) {
    this._current = flavor;
    // Set data-theme attribute on documentElement
    document.documentElement.setAttribute('data-theme', flavor);
    // Save to localStorage
    localStorage.setItem('cw_theme', flavor);
    // Update terminal theme
    this._updateTerminalTheme();
    // Update editor theme
    this._updateEditorTheme();
  },

  get current() {
    return this._current;
  },

  getColor(token) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue('--ctp-' + token)
      .trim();
  },

  getTerminalTheme() {
    return {
      background: this.getColor('base'),
      foreground: this.getColor('text'),
      cursor: this.getColor('rosewater'),
      selectionBackground: this.getColor('surface1'),
      black: this.getColor('surface1'),
      red: this.getColor('red'),
      green: this.getColor('green'),
      yellow: this.getColor('yellow'),
      blue: this.getColor('blue'),
      magenta: this.getColor('pink'),
      cyan: this.getColor('teal'),
      white: this.getColor('subtext1'),
      brightBlack: this.getColor('surface2'),
      brightRed: this.getColor('red'),
      brightGreen: this.getColor('green'),
      brightYellow: this.getColor('yellow'),
      brightBlue: this.getColor('blue'),
      brightMagenta: this.getColor('pink'),
      brightCyan: this.getColor('teal'),
      brightWhite: this.getColor('subtext0')
    };
  },

  _updateTerminalTheme() {
    if (!Riptide.Terminal || !Riptide.Terminal.instances) return;
    const theme = this.getTerminalTheme();
    for (const [, group] of Riptide.Terminal.instances) {
      for (const [, inst] of group.subTabs) {
        if (inst.term) {
          inst.term.options.theme = theme;
        }
      }
    }
  },

  _updateEditorTheme() {
    if (Riptide.Editor && Riptide.Editor.refreshTheme) {
      Riptide.Editor.refreshTheme();
    }
  }
};
