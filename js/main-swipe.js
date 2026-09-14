(() => {
  const OPEN_THRESHOLD = 70;
  const CLOSE_THRESHOLD = 70;
  const SCROLL_LEFT_TOLERANCE = 2;
  const START_DRAG_DISTANCE = 12;
  const HORIZONTAL_DOMINANCE = 1.15;
  const ANIMATION_MS = 280;

  let mode = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let previewOpened = false;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  function isInteractiveTarget(target) {
    return Boolean(target?.closest?.('button, a, input, select, textarea, label, [contenteditable="true"]'));
  }

  function getApp() {
    return document.getElementById('app');
  }

  function getFullView() {
    return document.getElementById('modal-full-view');
  }

  function getFullViewContainer() {
    return document.getElementById('full-view-container');
  }

  function isMainScreenActive() {
    const app = getApp();
    const fullView = getFullView();
    return Boolean(
      app &&
      !app.classList.contains('hidden') &&
      fullView &&
      fullView.classList.contains('hidden')
    );
  }

  function isFullViewActive() {
    const fullView = getFullView();
    return Boolean(fullView && !fullView.classList.contains('hidden'));
  }

  function isActivityBankAtLeftmostList() {
    const container = getFullViewContainer();
    return Boolean(container && container.scrollLeft <= SCROLL_LEFT_TOLERANCE);
  }

  function clearInlineAnimationStyles() {
    const fullView = getFullView();
    if (!fullView) return;
    fullView.style.transition = '';
    fullView.style.transform = '';
    fullView.style.willChange = '';
  }

  function transitionTo(x, onDone) {
    const fullView = getFullView();
    if (!fullView) {
      onDone?.();
      return;
    }

    const duration = reducedMotion ? 0 : ANIMATION_MS;
    fullView.style.willChange = 'transform';
    fullView.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    fullView.style.transform = `translate3d(${x}px, 0, 0)`;

    if (duration === 0) {
      requestAnimationFrame(() => onDone?.());
      return;
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      fullView.removeEventListener('transitionend', finish);
      onDone?.();
    };

    fullView.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, duration + 80);
  }

  function openPreviewAt(deltaX) {
    const fullView = getFullView();
    if (!fullView) return;

    if (!previewOpened) {
      fullView.style.transition = 'none';
      fullView.style.willChange = 'transform';
      fullView.style.transform = `translate3d(${window.innerWidth}px, 0, 0)`;
      document.getElementById('btn-full-view')?.click();
      previewOpened = isFullViewActive();
    }

    if (!previewOpened) return;

    const offset = Math.max(0, Math.min(window.innerWidth, window.innerWidth + deltaX));
    fullView.style.transition = 'none';
    fullView.style.transform = `translate3d(${offset}px, 0, 0)`;
  }

  function settleOpen(shouldOpen) {
    const fullView = getFullView();
    if (!fullView || !previewOpened) {
      resetGesture();
      return;
    }

    if (shouldOpen) {
      transitionTo(0, () => {
        clearInlineAnimationStyles();
        resetGesture();
      });
    } else {
      transitionTo(window.innerWidth, () => {
        document.getElementById('btn-close-full-view')?.click();
        clearInlineAnimationStyles();
        resetGesture();
      });
    }
  }

  function settleClose(shouldClose) {
    const fullView = getFullView();
    if (!fullView) {
      resetGesture();
      return;
    }

    if (shouldClose) {
      transitionTo(window.innerWidth, () => {
        document.getElementById('btn-close-full-view')?.click();
        clearInlineAnimationStyles();
        resetGesture();
      });
    } else {
      transitionTo(0, () => {
        clearInlineAnimationStyles();
        resetGesture();
      });
    }
  }

  function resetGesture() {
    mode = null;
    dragging = false;
    previewOpened = false;
  }

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || isInteractiveTarget(event.target)) {
      resetGesture();
      return;
    }

    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;

    if (isMainScreenActive()) {
      mode = 'open';
      dragging = false;
      previewOpened = false;
      return;
    }

    // O retorno depende da posição horizontal das listas, não da posição do dedo.
    // Se o banco já está totalmente à esquerda, um gesto para a direita pode fechá-lo.
    // Se ainda existem listas à esquerda, deixamos o navegador fazer a rolagem horizontal normal.
    if (isFullViewActive() && isActivityBankAtLeftmostList()) {
      mode = 'close';
      dragging = false;
      previewOpened = false;
      return;
    }

    resetGesture();
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!mode || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    const horizontalEnough = Math.abs(deltaX) >= Math.abs(deltaY) * HORIZONTAL_DOMINANCE;

    if (!dragging) {
      if (Math.abs(deltaX) < START_DRAG_DISTANCE) return;
      if (!horizontalEnough) {
        resetGesture();
        return;
      }

      if (mode === 'open' && deltaX >= 0) {
        resetGesture();
        return;
      }

      // No banco, um gesto para a esquerda continua navegando pelas listas.
      if (mode === 'close' && deltaX <= 0) {
        resetGesture();
        return;
      }

      dragging = true;
    }

    if (!horizontalEnough) return;

    event.preventDefault();

    if (mode === 'open') {
      openPreviewAt(deltaX);
      return;
    }

    if (mode === 'close') {
      const fullView = getFullView();
      if (!fullView) return;
      const offset = Math.max(0, Math.min(window.innerWidth, deltaX));
      fullView.style.willChange = 'transform';
      fullView.style.transition = 'none';
      fullView.style.transform = `translate3d(${offset}px, 0, 0)`;
    }
  }, { passive: false });

  document.addEventListener('touchend', (event) => {
    if (!mode || event.changedTouches.length !== 1) {
      resetGesture();
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    const horizontalEnough = Math.abs(deltaX) >= Math.abs(deltaY) * HORIZONTAL_DOMINANCE;

    if (mode === 'open') {
      if (!previewOpened) {
        if (deltaX <= -OPEN_THRESHOLD && horizontalEnough && isMainScreenActive()) {
          const fullView = getFullView();
          if (fullView) {
            fullView.style.transition = 'none';
            fullView.style.willChange = 'transform';
            fullView.style.transform = `translate3d(${window.innerWidth}px, 0, 0)`;
          }
          document.getElementById('btn-full-view')?.click();
          previewOpened = isFullViewActive();
        }
      }

      settleOpen(Boolean(previewOpened && deltaX <= -OPEN_THRESHOLD && horizontalEnough));
      return;
    }

    if (mode === 'close') {
      settleClose(Boolean(dragging && deltaX >= CLOSE_THRESHOLD && horizontalEnough));
      return;
    }

    resetGesture();
  }, { passive: true });

  document.addEventListener('touchcancel', () => {
    if (mode === 'open' && previewOpened) {
      settleOpen(false);
      return;
    }

    if (mode === 'close' && isFullViewActive()) {
      settleClose(false);
      return;
    }

    resetGesture();
  }, { passive: true });
})();
