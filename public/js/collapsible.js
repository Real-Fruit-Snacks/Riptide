window.Riptide = window.Riptide || {};

/**
 * Shared collapsible panel factory.
 *
 * Eliminates duplicated chevron/badge creation, hidden-state init,
 * click-to-toggle wiring, and toggle logic across panel modules.
 */
Riptide.CollapsiblePanel = {
  /**
   * Initialise a collapsible panel.
   *
   * @param {Object} opts
   * @param {string}  opts.sectionId    - ID of the outer container element
   * @param {string}  opts.listId       - ID of the content element that is shown/hidden
   * @param {string}  opts.headerId     - ID of the clickable header element
   * @param {string}  opts.chevronClass - CSS class for the chevron span
   * @param {string}  opts.badgeClass   - CSS class for the badge span
   * @param {boolean} [opts.startExpanded=false] - Whether to begin expanded
   * @param {string}  [opts.label]      - If provided the header is cleared and
   *                                       rebuilt as: chevron + " label" + badge.
   *                                       If omitted the chevron is prepended and
   *                                       the badge is appended to the existing header.
   * @returns {Object} panel — section, list, header, chevron, badge, expanded, toggle()
   */
  create(opts) {
    const section = document.getElementById(opts.sectionId);
    const list    = document.getElementById(opts.listId);
    const header  = document.getElementById(opts.headerId);

    const expanded = opts.startExpanded || false;

    // Chevron
    const chevron = document.createElement('span');
    chevron.className = opts.chevronClass;
    chevron.innerHTML = expanded ? '&#9660;' : '&#9654;';

    // Badge
    const badge = document.createElement('span');
    badge.className = opts.badgeClass;

    // Build header
    if (opts.label) {
      header.textContent = '';
      header.appendChild(chevron);
      header.appendChild(document.createTextNode(' ' + opts.label));
      header.appendChild(badge);
    } else {
      header.prepend(chevron);
      header.appendChild(badge);
    }

    // Initial collapsed/expanded state
    if (!expanded) {
      list.classList.add('hidden');
    }

    const panel = {
      section,
      list,
      header,
      chevron,
      badge,
      expanded,
      toggle() {
        this.expanded = !this.expanded;
        this.list.classList.toggle('hidden', !this.expanded);
        this.chevron.innerHTML = this.expanded ? '&#9660;' : '&#9654;';
      }
    };

    header.addEventListener('click', () => panel.toggle());

    return panel;
  }
};
