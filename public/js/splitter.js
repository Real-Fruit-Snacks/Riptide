window.Riptide = window.Riptide || {};

Riptide.Splitter = {
  init() {
    const splitter = document.getElementById('splitter');
    const leftPanel = document.getElementById('left-panel');
    const rightPanel = document.getElementById('right-panel');
    const mainContent = document.getElementById('main-content');
    let isDragging = false;
    let fitPending = false;

    splitter.addEventListener('mousedown', (e) => {
      isDragging = true;
      splitter.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = mainContent.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const totalWidth = rect.width;
      const splitterWidth = 6;
      const minPx = 200;

      const leftWidth = Math.max(minPx, Math.min(offsetX, totalWidth - minPx - splitterWidth));

      leftPanel.style.flex = 'none';
      leftPanel.style.width = leftWidth + 'px';
      rightPanel.style.flex = '1';

      // Throttled terminal resize
      if (!fitPending) {
        fitPending = true;
        requestAnimationFrame(() => {
          if (Riptide.Terminal && Riptide.Terminal.fit) {
            Riptide.Terminal.fit();
          }
          fitPending = false;
        });
      }
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      splitter.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (Riptide.Terminal && Riptide.Terminal.fit) {
        Riptide.Terminal.fit();
      }
    });
  }
};
