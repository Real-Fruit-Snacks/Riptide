window.Riptide = window.Riptide || {};

Riptide.Severity = {
  levels: [null, 'info', 'low', 'medium', 'high', 'critical'],

  next(current) {
    const idx = this.levels.indexOf(current);
    return this.levels[(idx + 1) % this.levels.length];
  },

  applyBadge(el, severity) {
    if (!el) return;
    // Remove all existing severity classes
    el.classList.remove('sev-info', 'sev-low', 'sev-medium', 'sev-high', 'sev-critical');
    if (severity) {
      el.textContent = severity.toUpperCase();
      el.classList.add('sev-' + severity);
      el.style.display = '';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }
};
