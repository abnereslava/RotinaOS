(() => {
  const MIN_HORIZONTAL_DISTANCE = 70;
  const HORIZONTAL_DOMINANCE = 1.25;

  let startX = 0;
  let startY = 0;
  let tracking = false;

  function isInteractiveTarget(target) {
    return Boolean(target?.closest?.('button, a, input, select, textarea, label, [contenteditable="true"]'));
  }

  function isMainScreenActive() {
    const app = document.getElementById('app');
    const fullView = document.getElementById('modal-full-view');
    return Boolean(
      app &&
      !app.classList.contains('hidden') &&
      fullView &&
      fullView.classList.contains('hidden')
    );
  }

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || !isMainScreenActive() || isInteractiveTarget(event.target)) {
      tracking = false;
      return;
    }

    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    tracking = true;
  }, { passive: true });

  document.addEventListener('touchend', (event) => {
    if (!tracking || event.changedTouches.length !== 1 || !isMainScreenActive()) {
      tracking = false;
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;

    tracking = false;

    const isLeftSwipe = deltaX <= -MIN_HORIZONTAL_DISTANCE;
    const isMostlyHorizontal = Math.abs(deltaX) >= Math.abs(deltaY) * HORIZONTAL_DOMINANCE;

    if (!isLeftSwipe || !isMostlyHorizontal) return;

    document.getElementById('btn-full-view')?.click();
  }, { passive: true });

  document.addEventListener('touchcancel', () => {
    tracking = false;
  }, { passive: true });
})();
