window.Riptide = window.Riptide || {};

/**
 * Copy text to clipboard with fallback for older browsers.
 * @param {string} text - Text to copy
 * @param {string} [label] - Optional label for toast (e.g., "password", "hash")
 */
Riptide.clipboard = function(text, label) {
  if (!text) return;

  const msg = label ? label + ' copied' : 'Copied to clipboard';

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      Riptide.toast(msg);
    }).catch(() => {
      _fallbackCopy(text, msg);
    });
  } else {
    _fallbackCopy(text, msg);
  }

  function _fallbackCopy(text, successMsg) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      Riptide.toast(successMsg);
    } catch {
      Riptide.toast('Failed to copy');
    }
    document.body.removeChild(ta);
  }
};
