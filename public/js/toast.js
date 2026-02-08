window.Riptide = window.Riptide || {};

Riptide.toast = function(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    const fallback = setTimeout(() => { if (el.parentNode) el.remove(); }, 500);
    el.addEventListener('transitionend', () => {
      clearTimeout(fallback);
      if (el.parentNode) el.remove();
    }, { once: true });
  }, 1500);
};
