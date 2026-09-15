(() => {
  const GUARD_STATE_KEY = 'rotinaosBackGuard';
  let guardArmed = false;
  let handlingPop = false;

  function isMobileContext() {
    return Boolean(
      window.matchMedia?.('(pointer: coarse)')?.matches ||
      window.matchMedia?.('(max-width: 900px)')?.matches
    );
  }

  function isAppActive() {
    const app = document.getElementById('app');
    return Boolean(app && !app.classList.contains('hidden'));
  }

  function isVisible(element) {
    if (!element || element.classList.contains('hidden')) return false;
    return true;
  }

  function clickFirst(container, selector) {
    const button = container?.querySelector?.(selector);
    if (!button) return false;
    button.click();
    return true;
  }

  function closeCalendarControlModal() {
    const controls = [
      document.getElementById('calendar-category-modal'),
      document.getElementById('calendar-month-picker-modal')
    ];

    for (const modal of controls) {
      if (!isVisible(modal)) continue;
      if (!clickFirst(modal, '[data-close-calendar-control]')) {
        modal.classList.add('hidden');
      }
      return true;
    }
    return false;
  }

  function closeModalByButton(id, selector) {
    const modal = document.getElementById(id);
    if (!isVisible(modal)) return false;
    if (!clickFirst(modal, selector)) modal.classList.add('hidden');
    return true;
  }

  function closeTopLayer() {
    // Edição inline da categoria é a camada mais interna do Banco.
    if (window.RotinaCategoryRename?.cancelActiveEditor?.()) return true;

    // Controles internos do calendário.
    if (closeCalendarControlModal()) return true;

    // Diálogos de confirmação/aviso podem estar sobre qualquer outro modal.
    if (closeModalByButton('modal-confirm', '#modal-confirm-cancel')) return true;
    if (closeModalByButton('modal-alert', '#modal-alert-ok')) return true;

    // Modal de detalhes criado dinamicamente pelo app.
    const detail = document.getElementById('modal-detail-overlay');
    if (isVisible(detail)) {
      if (!clickFirst(detail, '#btn-close-detail')) detail.remove();
      return true;
    }

    // Modais normais da aplicação.
    if (closeModalByButton('modal-activity', '.close-modal')) return true;
    if (closeModalByButton('modal-schedule', '.close-modal')) return true;
    if (closeModalByButton('modal-completion', '.close-modal')) return true;
    if (closeModalByButton('modal-style', '#btn-close-style, .close-modal')) return true;
    if (closeModalByButton('modal-demo-notice', '#btn-close-demo-notice')) return true;

    // Calendário é uma tela lateral própria.
    const calendar = document.getElementById('calendar-view');
    if (isVisible(calendar)) {
      document.dispatchEvent(new CustomEvent('rotinaos:calendar-close-request'));
      return true;
    }

    // Banco de Atividades.
    const bank = document.getElementById('modal-full-view');
    if (isVisible(bank)) {
      document.getElementById('btn-close-full-view')?.click();
      return true;
    }

    // Hub legado, caso esteja aberto por alguma rota interna.
    const sidebar = document.getElementById('sidebar');
    if (isVisible(sidebar)) {
      document.getElementById('close-sidebar')?.click();
      return true;
    }

    return false;
  }

  function pushGuardState() {
    if (!isMobileContext() || !isAppActive()) return false;

    try {
      history.pushState(
        { ...(history.state || {}), [GUARD_STATE_KEY]: true },
        '',
        window.location.href
      );
      guardArmed = true;
      return true;
    } catch (error) {
      console.warn('Não foi possível proteger a navegação de retorno:', error);
      guardArmed = false;
      return false;
    }
  }

  function ensureGuard() {
    if (!isMobileContext() || !isAppActive()) return;
    if (guardArmed && history.state?.[GUARD_STATE_KEY]) return;
    pushGuardState();
  }

  window.addEventListener('popstate', () => {
    if (!isMobileContext() || !isAppActive()) {
      guardArmed = false;
      return;
    }

    if (handlingPop) return;
    handlingPop = true;

    // O primeiro retorno sempre pertence ao RotinaOS. Se houver uma camada
    // aberta, fecha a mais interna; se já estivermos na tela principal, apenas
    // preserva o app em vez de deixar o Android/navegador sair imediatamente.
    closeTopLayer();
    pushGuardState();

    window.setTimeout(() => {
      handlingPop = false;
    }, 0);
  });

  function observeAppVisibility() {
    const app = document.getElementById('app');
    if (!app) return;

    new MutationObserver(() => {
      if (isAppActive()) ensureGuard();
      else guardArmed = false;
    }).observe(app, { attributes: true, attributeFilter: ['class'] });
  }

  function init() {
    observeAppVisibility();
    ensureGuard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.addEventListener('pageshow', ensureGuard);

  window.RotinaMobileBackNavigation = {
    closeTopLayer,
    ensureGuard
  };
})();
