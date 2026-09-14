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

  function getCalendarView() {
    return document.getElementById('calendar-view');
  }

  function isFullViewActive() {
    const fullView = getFullView();
    return Boolean(fullView && !fullView.classList.contains('hidden'));
  }

  function isCalendarActive() {
    const calendar = getCalendarView();
    return Boolean(calendar && !calendar.classList.contains('hidden'));
  }

  function isMainScreenActive() {
    const app = getApp();
    const fullView = getFullView();
    const calendar = getCalendarView();
    return Boolean(
      app &&
      !app.classList.contains('hidden') &&
      fullView &&
      fullView.classList.contains('hidden') &&
      (!calendar || calendar.classList.contains('hidden'))
    );
  }

  function isActivityBankAtLeftmostList() {
    const container = getFullViewContainer();
    return Boolean(container && container.scrollLeft <= SCROLL_LEFT_TOLERANCE);
  }

  function clearInlineAnimationStyles(element) {
    if (!element) return;
    element.style.transition = '';
    element.style.transform = '';
    element.style.willChange = '';
  }

  function transitionElementTo(element, x, onDone) {
    if (!element) {
      onDone?.();
      return;
    }

    const duration = reducedMotion ? 0 : ANIMATION_MS;
    element.style.willChange = 'transform';
    element.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    element.style.transform = `translate3d(${x}px, 0, 0)`;

    if (duration === 0) {
      requestAnimationFrame(() => onDone?.());
      return;
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      element.removeEventListener('transitionend', finish);
      onDone?.();
    };

    element.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, duration + 80);
  }

  function showCalendarPreview() {
    const calendar = getCalendarView();
    if (!calendar) return false;

    if (calendar.classList.contains('hidden')) {
      calendar.style.transition = 'none';
      calendar.style.willChange = 'transform';
      calendar.style.transform = `translate3d(${-window.innerWidth}px, 0, 0)`;
      calendar.classList.remove('hidden');
      calendar.dispatchEvent(new CustomEvent('rotinaos:calendar-open'));
    }

    return isCalendarActive();
  }

  function openBankPreviewAt(deltaX) {
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

  function openCalendarPreviewAt(deltaX) {
    const calendar = getCalendarView();
    if (!calendar) return;

    if (!previewOpened) {
      previewOpened = showCalendarPreview();
    }

    if (!previewOpened) return;

    const offset = Math.min(0, Math.max(-window.innerWidth, -window.innerWidth + deltaX));
    calendar.style.transition = 'none';
    calendar.style.willChange = 'transform';
    calendar.style.transform = `translate3d(${offset}px, 0, 0)`;
  }

  function settleBankOpen(shouldOpen) {
    const fullView = getFullView();
    if (!fullView || !previewOpened) {
      resetGesture();
      return;
    }

    if (shouldOpen) {
      transitionElementTo(fullView, 0, () => {
        clearInlineAnimationStyles(fullView);
        resetGesture();
      });
    } else {
      transitionElementTo(fullView, window.innerWidth, () => {
        document.getElementById('btn-close-full-view')?.click();
        clearInlineAnimationStyles(fullView);
        resetGesture();
      });
    }
  }

  function settleBankClose(shouldClose) {
    const fullView = getFullView();
    if (!fullView) {
      resetGesture();
      return;
    }

    if (shouldClose) {
      transitionElementTo(fullView, window.innerWidth, () => {
        document.getElementById('btn-close-full-view')?.click();
        clearInlineAnimationStyles(fullView);
        resetGesture();
      });
    } else {
      transitionElementTo(fullView, 0, () => {
        clearInlineAnimationStyles(fullView);
        resetGesture();
      });
    }
  }

  function settleCalendarOpen(shouldOpen) {
    const calendar = getCalendarView();
    if (!calendar || !previewOpened) {
      resetGesture();
      return;
    }

    if (shouldOpen) {
      transitionElementTo(calendar, 0, () => {
        clearInlineAnimationStyles(calendar);
        resetGesture();
      });
    } else {
      transitionElementTo(calendar, -window.innerWidth, () => {
        calendar.classList.add('hidden');
        clearInlineAnimationStyles(calendar);
        resetGesture();
      });
    }
  }

  function settleCalendarClose(shouldClose) {
    const calendar = getCalendarView();
    if (!calendar) {
      resetGesture();
      return;
    }

    if (shouldClose) {
      transitionElementTo(calendar, -window.innerWidth, () => {
        calendar.classList.add('hidden');
        calendar.dispatchEvent(new CustomEvent('rotinaos:calendar-close'));
        clearInlineAnimationStyles(calendar);
        resetGesture();
      });
    } else {
      transitionElementTo(calendar, 0, () => {
        clearInlineAnimationStyles(calendar);
        resetGesture();
      });
    }
  }

  function closeCalendarAnimated() {
    const calendar = getCalendarView();
    if (!calendar || calendar.classList.contains('hidden')) return;
    transitionElementTo(calendar, -window.innerWidth, () => {
      calendar.classList.add('hidden');
      calendar.dispatchEvent(new CustomEvent('rotinaos:calendar-close'));
      clearInlineAnimationStyles(calendar);
      resetGesture();
    });
  }

  function resetGesture() {
    mode = null;
    dragging = false;
    previewOpened = false;
  }

  document.addEventListener('rotinaos:calendar-close-request', closeCalendarAnimated);

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || isInteractiveTarget(event.target)) {
      resetGesture();
      return;
    }

    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;

    if (isMainScreenActive()) {
      mode = 'main';
      dragging = false;
      previewOpened = false;
      return;
    }

    if (isCalendarActive()) {
      mode = 'close-calendar';
      dragging = false;
      previewOpened = false;
      return;
    }

    // O retorno do Banco depende da posição das listas, não da posição do dedo.
    if (isFullViewActive() && isActivityBankAtLeftmostList()) {
      mode = 'close-bank';
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

      if (mode === 'main') {
        mode = deltaX < 0 ? 'open-bank' : 'open-calendar';
      }

      if (mode === 'close-bank' && deltaX <= 0) {
        // Swipe para a esquerda continua navegando pelas listas do Banco.
        resetGesture();
        return;
      }

      if (mode === 'close-calendar' && deltaX >= 0) {
        resetGesture();
        return;
      }

      dragging = true;
    }

    if (!horizontalEnough) return;

    event.preventDefault();

    if (mode === 'open-bank') {
      openBankPreviewAt(deltaX);
      return;
    }

    if (mode === 'open-calendar') {
      openCalendarPreviewAt(deltaX);
      return;
    }

    if (mode === 'close-bank') {
      const fullView = getFullView();
      if (!fullView) return;
      const offset = Math.max(0, Math.min(window.innerWidth, deltaX));
      fullView.style.willChange = 'transform';
      fullView.style.transition = 'none';
      fullView.style.transform = `translate3d(${offset}px, 0, 0)`;
      return;
    }

    if (mode === 'close-calendar') {
      const calendar = getCalendarView();
      if (!calendar) return;
      const offset = Math.max(-window.innerWidth, Math.min(0, deltaX));
      calendar.style.willChange = 'transform';
      calendar.style.transition = 'none';
      calendar.style.transform = `translate3d(${offset}px, 0, 0)`;
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

    if (mode === 'main') {
      // Movimento curto demais para iniciar uma navegação.
      resetGesture();
      return;
    }

    if (mode === 'open-bank') {
      if (!previewOpened && deltaX <= -OPEN_THRESHOLD && horizontalEnough && isMainScreenActive()) {
        const fullView = getFullView();
        if (fullView) {
          fullView.style.transition = 'none';
          fullView.style.willChange = 'transform';
          fullView.style.transform = `translate3d(${window.innerWidth}px, 0, 0)`;
        }
        document.getElementById('btn-full-view')?.click();
        previewOpened = isFullViewActive();
      }

      settleBankOpen(Boolean(previewOpened && deltaX <= -OPEN_THRESHOLD && horizontalEnough));
      return;
    }

    if (mode === 'open-calendar') {
      if (!previewOpened && deltaX >= OPEN_THRESHOLD && horizontalEnough && isMainScreenActive()) {
        previewOpened = showCalendarPreview();
      }

      settleCalendarOpen(Boolean(previewOpened && deltaX >= OPEN_THRESHOLD && horizontalEnough));
      return;
    }

    if (mode === 'close-bank') {
      settleBankClose(Boolean(dragging && deltaX >= CLOSE_THRESHOLD && horizontalEnough));
      return;
    }

    if (mode === 'close-calendar') {
      settleCalendarClose(Boolean(dragging && deltaX <= -CLOSE_THRESHOLD && horizontalEnough));
      return;
    }

    resetGesture();
  }, { passive: true });

  document.addEventListener('touchcancel', () => {
    if (mode === 'open-bank' && previewOpened) {
      settleBankOpen(false);
      return;
    }

    if (mode === 'open-calendar' && previewOpened) {
      settleCalendarOpen(false);
      return;
    }

    if (mode === 'close-bank' && isFullViewActive()) {
      settleBankClose(false);
      return;
    }

    if (mode === 'close-calendar' && isCalendarActive()) {
      settleCalendarClose(false);
      return;
    }

    resetGesture();
  }, { passive: true });

  window.RotinaSwipeNavigation = {
    closeCalendar: closeCalendarAnimated
  };
})();
