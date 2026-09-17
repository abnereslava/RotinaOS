(() => {
  /*
   * O app principal é importado depois do login. Por isso o antigo listener de
   * DOMContentLoaded do app.js pode nascer depois que o evento já ocorreu.
   * Este módulo restaura os controles independentemente desse timing e também
   * persiste buscas/aba do Banco, que antes não eram salvas.
   */

  const state = {
    sidebarCategory: localStorage.getItem('sidebarFilterCategory') || '',
    sidebarSort: localStorage.getItem('sidebarSortMode') || 'none',
    sidebarSearch: localStorage.getItem('sidebarSearchTerm') || '',
    sidebarTab: localStorage.getItem('sidebarCurrentTab') || 'pending',
    fullViewSort: localStorage.getItem('fullViewSortMode') || 'none',
    fullViewSearch: localStorage.getItem('fullViewSearchTerm') || ''
  };

  let restoringTab = false;
  let categoryRestoreScheduled = false;

  function optionExists(select, value) {
    if (!select) return false;
    return Array.from(select.options).some(option => option.value === value);
  }

  function restoreSimpleControls() {
    const sidebarSearch = document.getElementById('search-activity');
    if (sidebarSearch && sidebarSearch.value !== state.sidebarSearch) {
      sidebarSearch.value = state.sidebarSearch;
    }

    const sidebarSort = document.getElementById('sort-activities');
    if (sidebarSort && optionExists(sidebarSort, state.sidebarSort) && sidebarSort.value !== state.sidebarSort) {
      sidebarSort.value = state.sidebarSort;
    }

    const fullSearch = document.getElementById('full-view-search');
    if (fullSearch && fullSearch.value !== state.fullViewSearch) {
      fullSearch.value = state.fullViewSearch;
    }

    const fullSort = document.getElementById('full-view-sort');
    if (fullSort && optionExists(fullSort, state.fullViewSort) && fullSort.value !== state.fullViewSort) {
      fullSort.value = state.fullViewSort;
    }
  }

  function restoreCategory({ notify = true } = {}) {
    const select = document.getElementById('filter-category');
    if (!select) return false;

    if (!state.sidebarCategory) {
      if (select.value !== '') {
        select.value = '';
        if (notify) select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }

    if (!optionExists(select, state.sidebarCategory)) return false;

    if (select.value !== state.sidebarCategory) {
      select.value = state.sidebarCategory;
      if (notify) select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function restoreSidebarTab() {
    if (restoringTab) return;
    const app = document.getElementById('app');
    if (!app || app.classList.contains('hidden')) return;

    const target = document.getElementById(`tab-${state.sidebarTab}`);
    if (!target) return;

    restoringTab = true;
    requestAnimationFrame(() => {
      try {
        target.click();
      } finally {
        restoringTab = false;
      }
    });
  }

  function restoreAll({ notifyCategory = false, restoreTab = false } = {}) {
    restoreSimpleControls();
    restoreCategory({ notify: notifyCategory });
    if (restoreTab) restoreSidebarTab();
  }

  // Restaura o que já existe no HTML antes mesmo do módulo principal carregar.
  restoreAll({ notifyCategory: false, restoreTab: false });

  // Salva buscas, selects e aba através de delegação; funciona mesmo com app dinâmico.
  document.addEventListener('input', event => {
    const target = event.target;
    if (target?.id === 'search-activity') {
      state.sidebarSearch = target.value;
      localStorage.setItem('sidebarSearchTerm', state.sidebarSearch);
    } else if (target?.id === 'full-view-search') {
      state.fullViewSearch = target.value;
      localStorage.setItem('fullViewSearchTerm', state.fullViewSearch);
    }
  }, true);

  document.addEventListener('change', event => {
    const target = event.target;
    if (target?.id === 'filter-category') {
      state.sidebarCategory = target.value;
      localStorage.setItem('sidebarFilterCategory', state.sidebarCategory);
    } else if (target?.id === 'sort-activities') {
      state.sidebarSort = target.value;
      localStorage.setItem('sidebarSortMode', state.sidebarSort);
    } else if (target?.id === 'full-view-sort') {
      state.fullViewSort = target.value;
      localStorage.setItem('fullViewSortMode', state.fullViewSort);
    }
  }, true);

  document.addEventListener('click', event => {
    const tab = event.target.closest?.('#tab-pending, #tab-scheduled, #tab-all');
    if (tab && !restoringTab) {
      state.sidebarTab = tab.id.replace('tab-', '');
      localStorage.setItem('sidebarCurrentTab', state.sidebarTab);
    }

    // Antes do handler original abrir/renderizar o Banco, recoloca busca e ordenação.
    if (event.target.closest?.('#btn-full-view')) {
      restoreSimpleControls();
    }
  }, true);

  // O select de categorias é reconstruído sempre que as atividades mudam.
  const categorySelect = document.getElementById('filter-category');
  if (categorySelect) {
    const categoryObserver = new MutationObserver(() => {
      if (categoryRestoreScheduled) return;
      categoryRestoreScheduled = true;
      queueMicrotask(() => {
        categoryRestoreScheduled = false;
        restoreCategory({ notify: true });
      });
    });
    categoryObserver.observe(categorySelect, { childList: true, subtree: true });
  }

  // Quando o login libera o app, os listeners do app.js já foram registrados.
  const app = document.getElementById('app');
  if (app) {
    const appObserver = new MutationObserver(() => {
      if (!app.classList.contains('hidden')) {
        setTimeout(() => restoreAll({ notifyCategory: true, restoreTab: true }), 0);
      }
    });
    appObserver.observe(app, { attributes: true, attributeFilter: ['class'] });

    if (!app.classList.contains('hidden')) {
      setTimeout(() => restoreAll({ notifyCategory: true, restoreTab: true }), 0);
    }
  }

  window.addEventListener('pageshow', () => {
    restoreAll({ notifyCategory: true, restoreTab: true });
  });
})();
