(() => {
  const THRESHOLD = 70;
  const START_DRAG_DISTANCE = 12;
  const HORIZONTAL_DOMINANCE = 1.15;
  const ANIMATION_MS = 280;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  let gesture = null;
  let animating = false;
  let suppressedRow = null;
  let suppressClickUntil = 0;

  const element = id => document.getElementById(id);
  const visible = id => Boolean(element(id) && !element(id).classList.contains('hidden'));
  const screenId = screen => ({ weekly: 'weekly-checklist-view', calendar: 'calendar-view', bank: 'modal-full-view' }[screen]);
  function interactive(target) {
    return Boolean(target?.closest?.('button, a, input, select, textarea, label, [contenteditable="true"]'));
  }
  function weeklyRowKey(target) {
    return target?.closest?.('#weekly-items tr')?.querySelector('[data-weekly-id]')?.dataset.weeklyId || null;
  }
  function suppressRowClick() {
    if (!gesture?.dragging || !gesture.rowKey) return;
    suppressedRow = gesture.rowKey;
    suppressClickUntil = performance.now() + 1000;
  }
  function modalOpen() {
    return Boolean(document.querySelector(
      '.modal:not(.hidden):not(#modal-full-view), .calendar-control-modal:not(.hidden), dialog[open]'
    ));
  }
  function currentScreen() {
    if (!visible('app') || modalOpen()) return null;
    if (visible('calendar-view')) return 'calendar';
    if (visible('weekly-checklist-view')) return 'weekly';
    if (visible('modal-full-view')) {
      return element('full-view-container')?.scrollLeft <= 2 ? 'bank' : null;
    }
    return 'main';
  }
  function clearStyles(view) {
    if (!view) return;
    view.style.transition = '';
    view.style.transform = '';
    view.style.willChange = '';
  }
  function show(screen) {
    const view = element(screenId(screen));
    if (!view) return false;
    if (screen === 'bank') element('btn-full-view')?.click();
    else {
      view.classList.remove('hidden');
      view.dispatchEvent(new CustomEvent(`rotinaos:${screen}-open`));
    }
    return !view.classList.contains('hidden');
  }
  function hide(screen) {
    const view = element(screenId(screen));
    if (!view) return;
    if (screen === 'bank') element('btn-close-full-view')?.click();
    else {
      view.classList.add('hidden');
      view.dispatchEvent(new CustomEvent(`rotinaos:${screen}-close`));
    }
    clearStyles(view);
  }
  function transition(view, x, done) {
    animating = true;
    const duration = reducedMotion ? 0 : ANIMATION_MS;
    view.style.willChange = 'transform';
    view.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    view.style.transform = `translate3d(${x}px, 0, 0)`;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      view.removeEventListener('transitionend', finish);
      clearStyles(view);
      animating = false;
      gesture = null;
      done?.();
    };
    view.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, duration + 80);
  }
  function decide(origin, deltaX) {
    if (origin === 'main') return deltaX < 0
      ? { screen: 'bank', sign: 1, opening: true }
      : { screen: 'weekly', sign: -1, opening: true };
    if (origin === 'weekly') return deltaX > 0
      ? { screen: 'calendar', sign: -1, opening: true }
      : { screen: 'weekly', sign: -1, opening: false };
    if (origin === 'calendar' && deltaX < 0) return { screen: 'calendar', sign: -1, opening: false };
    if (origin === 'bank' && deltaX > 0) return { screen: 'bank', sign: 1, opening: false };
    return null;
  }
  function preview(deltaX) {
    const g = gesture;
    const view = element(screenId(g.screen));
    if (!view) return;
    if (g.opening && !g.previewOpened) {
      view.style.transition = 'none';
      view.style.transform = `translate3d(${g.sign * innerWidth}px, 0, 0)`;
      g.previewOpened = show(g.screen);
      if (!g.previewOpened) return;
    }
    const raw = g.opening ? g.sign * innerWidth + deltaX : deltaX;
    const offset = g.sign < 0 ? Math.max(-innerWidth, Math.min(0, raw)) : Math.max(0, Math.min(innerWidth, raw));
    view.style.willChange = 'transform';
    view.style.transition = 'none';
    view.style.transform = `translate3d(${offset}px, 0, 0)`;
  }
  function settle(commit) {
    const g = gesture;
    if (!g?.dragging || (g.opening && !g.previewOpened)) { gesture = null; return; }
    const view = element(screenId(g.screen));
    if (!view) { gesture = null; return; }
    const shouldHide = g.opening ? !commit : commit;
    transition(view, shouldHide ? g.sign * innerWidth : 0, () => {
      if (shouldHide) hide(g.screen);
    });
  }
  function openAnimated(screen) {
    const view = element(screenId(screen));
    if (!view || visible(screenId(screen)) || animating || gesture || modalOpen() || !visible('app')) return;
    view.style.transition = 'none';
    view.style.transform = `translate3d(${-innerWidth}px, 0, 0)`;
    if (!show(screen)) return;
    // Consolida a posição inicial antes de iniciar a transição por botão.
    view.getBoundingClientRect();
    transition(view, 0);
  }
  function closeAnimated(screen) {
    const view = element(screenId(screen));
    if (!view || !visible(screenId(screen)) || animating || gesture) return;
    transition(view, -innerWidth, () => hide(screen));
  }

  document.addEventListener('rotinaos:calendar-close-request', () => closeAnimated('calendar'));
  document.addEventListener('rotinaos:weekly-close-request', () => closeAnimated('weekly'));
  document.addEventListener('touchstart', event => {
    if (animating) return;
    suppressedRow = null;
    suppressClickUntil = 0;
    if (gesture?.dragging) { settle(false); return; }
    gesture = null;
    if (event.touches.length !== 1) return;
    const origin = currentScreen();
    if (!origin) return;
    const rowKey = origin === 'weekly' ? weeklyRowKey(event.target) : null;
    // Títulos, checks e remoção continuam recebendo toques simples, mas um
    // arraste sobre a linha também participa da navegação entre telas.
    if (interactive(event.target) && !rowKey) return;
    const touch = event.touches[0];
    gesture = { origin, rowKey, startX: touch.clientX, startY: touch.clientY, dragging: false, previewOpened: false };
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (!gesture || animating) return;
    if (event.touches.length !== 1) { settle(false); return; }
    const deltaX = event.touches[0].clientX - gesture.startX;
    const deltaY = event.touches[0].clientY - gesture.startY;
    const horizontal = Math.abs(deltaX) >= Math.abs(deltaY) * HORIZONTAL_DOMINANCE;
    if (!gesture.dragging) {
      if (Math.abs(deltaX) < START_DRAG_DISTANCE) {
        if (Math.abs(deltaY) >= START_DRAG_DISTANCE) gesture = null;
        return;
      }
      if (!horizontal) { gesture = null; return; }
      const route = decide(gesture.origin, deltaX);
      if (!route) { gesture = null; return; }
      Object.assign(gesture, route, { dragging: true });
    }
    event.preventDefault();
    suppressRowClick();
    preview(deltaX);
  }, { passive: false });
  document.addEventListener('touchend', event => {
    if (!gesture || animating) return;
    if (!gesture.dragging || event.changedTouches.length !== 1) { settle(false); return; }
    const deltaX = event.changedTouches[0].clientX - gesture.startX;
    const deltaY = event.changedTouches[0].clientY - gesture.startY;
    const horizontal = Math.abs(deltaX) >= Math.abs(deltaY) * HORIZONTAL_DOMINANCE;
    const progress = gesture.opening ? -deltaX * gesture.sign : deltaX * gesture.sign;
    suppressRowClick();
    settle(horizontal && progress >= THRESHOLD);
  }, { passive: true });
  document.addEventListener('touchcancel', () => {
    if (!animating) { suppressRowClick(); settle(false); }
  }, { passive: true });
  // Alguns navegadores emitem click ao soltar o dedo mesmo após um arraste.
  // Intercepta esse click antes das ações de abrir, concluir ou remover o item.
  document.addEventListener('click', event => {
    if (!suppressedRow || performance.now() >= suppressClickUntil || weeklyRowKey(event.target) !== suppressedRow) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressedRow = null;
  }, true);

  window.RotinaSwipeNavigation = {
    closeCalendar: () => closeAnimated('calendar'),
    openCalendar: () => openAnimated('calendar'),
    openWeekly: () => openAnimated('weekly'),
    closeWeekly: () => closeAnimated('weekly'),
    hideWeekly: () => hide('weekly')
  };
})();
