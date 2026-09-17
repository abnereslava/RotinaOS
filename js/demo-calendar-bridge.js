const DEMO_EVENT = 'rotinaos:demo-activities';
const DEMO_FILTER_KEY = 'rotinaos.demo.calendar.categoryFilter.v1';

let demoActivities = [];
let gridObserver = null;
let renderQueued = false;
let demoCategoryFilter = loadDemoFilter();

function isDemoMode() {
  return Boolean(window.__ROTINAOS_DEMO__);
}

function getTodayString() {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function normalizeCategory(value) {
  return String(value || '').trim() || 'Sem categoria';
}

function loadDemoFilter() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_FILTER_KEY) || 'null');
    if (!saved || saved.mode === 'all') return null;
    if (saved.mode === 'selected' && Array.isArray(saved.categories)) {
      return new Set(saved.categories.map(normalizeCategory));
    }
  } catch (_) {}
  return null;
}

function saveDemoFilter() {
  if (demoCategoryFilter === null) {
    localStorage.setItem(DEMO_FILTER_KEY, JSON.stringify({ mode: 'all' }));
    return;
  }
  localStorage.setItem(DEMO_FILTER_KEY, JSON.stringify({
    mode: 'selected',
    categories: [...demoCategoryFilter]
  }));
}

function getDemoCategories() {
  return [...new Set(demoActivities.map(item => normalizeCategory(item.category)))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function categoryIsVisible(activity) {
  return demoCategoryFilter === null || demoCategoryFilter.has(normalizeCategory(activity.category));
}

function parseMonthlyDays(value) {
  if (!value) return [];
  return String(value).split(',')
    .map(item => Number.parseInt(item.trim(), 10))
    .filter(day => Number.isInteger(day) && day >= 1 && day <= 31);
}

function occursOn(activity, dateKey) {
  const date = parseDateKey(dateKey);
  if (activity.recurrence === 'single') return activity.scheduledDate === dateKey;
  if (activity.recurrence === 'daily') return true;
  if (activity.recurrence === 'weekly') return Array.isArray(activity.fixedDays) && activity.fixedDays.map(Number).includes(date.getDay());
  if (activity.recurrence === 'monthly') return parseMonthlyDays(activity.monthlyDays).includes(date.getDate());
  return false;
}

function statusFor(activity, dateKey) {
  if (activity.completionDate !== dateKey) return 'pending';
  if (activity.status === 'completed') return 'completed';
  if (activity.status === 'partial') return 'partial';
  return 'pending';
}

function activitiesForDate(dateKey) {
  return demoActivities
    .filter(categoryIsVisible)
    .filter(activity => occursOn(activity, dateKey))
    .sort((a, b) => {
      const timeA = a.scheduledTime || '99:99';
      const timeB = b.scheduledTime || '99:99';
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
    });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatSelectedDate(dateKey) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(parseDateKey(dateKey));
}

function recurrenceLabel(value) {
  return {
    single: 'Única',
    daily: 'Diária',
    weekly: 'Semanal',
    monthly: 'Mensal'
  }[value] || 'Atividade';
}

function statusLabel(value) {
  if (value === 'completed') return 'Concluída';
  if (value === 'partial') return 'Parcial';
  return 'Pendente';
}

function renderDayCells() {
  document.querySelectorAll('#calendar-grid .calendar-day[data-date]').forEach(cell => {
    const dateKey = cell.dataset.date;
    const list = activitiesForDate(dateKey);

    cell.classList.toggle('has-tasks', list.length > 0);
    cell.querySelectorAll('.calendar-task-count, .calendar-status-dots').forEach(item => item.remove());

    if (!list.length) return;

    const count = document.createElement('span');
    count.className = 'calendar-task-count';
    count.textContent = String(list.length);
    cell.appendChild(count);

    const completed = list.filter(item => statusFor(item, dateKey) === 'completed').length;
    const partial = list.filter(item => statusFor(item, dateKey) === 'partial').length;
    if (completed || partial) {
      const dots = document.createElement('span');
      dots.className = 'calendar-status-dots';
      dots.setAttribute('aria-hidden', 'true');
      dots.innerHTML = `${completed ? '<i class="status-dot completed"></i>' : ''}${partial ? '<i class="status-dot partial"></i>' : ''}`;
      cell.appendChild(dots);
    }
  });
}

function renderSelectedDay() {
  const selectedCell = document.querySelector('#calendar-grid .calendar-day.is-selected[data-date]');
  const dateKey = selectedCell?.dataset.date || getTodayString();
  const title = document.getElementById('calendar-selected-date');
  const count = document.getElementById('calendar-selected-count');
  const listEl = document.getElementById('calendar-selected-tasks');
  if (!title || !count || !listEl) return;

  const list = activitiesForDate(dateKey);
  title.textContent = formatSelectedDate(dateKey);
  count.textContent = String(list.length);
  listEl.innerHTML = '';

  if (!list.length) {
    listEl.innerHTML = '<div class="calendar-empty-day">Nenhuma tarefa da demonstração para este dia.</div>';
    return;
  }

  list.forEach(activity => {
    const status = statusFor(activity, dateKey);
    const row = document.createElement('div');
    row.className = `calendar-task-row status-${status}`;
    row.innerHTML = `
      <div class="calendar-task-time">${escapeHtml(activity.scheduledTime || 'Sem horário')}</div>
      <div class="calendar-task-main">
        <strong>${escapeHtml(activity.title || 'Sem título')}</strong>
        <span>${escapeHtml(normalizeCategory(activity.category))} · ${recurrenceLabel(activity.recurrence)} · ${statusLabel(status)}</span>
      </div>
    `;
    listEl.appendChild(row);
  });
}

function hasAnyFutureOccurrence(activity) {
  if (activity.recurrence === 'single') return Boolean(activity.scheduledDate);
  if (activity.recurrence === 'daily') return true;
  if (activity.recurrence === 'weekly') return Array.isArray(activity.fixedDays) && activity.fixedDays.length > 0;
  if (activity.recurrence === 'monthly') return parseMonthlyDays(activity.monthlyDays).length > 0;
  return false;
}

function renderUnprogrammedCount() {
  const element = document.getElementById('calendar-unprogrammed');
  if (!element) return;
  const count = demoActivities.filter(categoryIsVisible).filter(activity => !hasAnyFutureOccurrence(activity)).length;
  element.textContent = `+${count} ${count === 1 ? 'tarefa não programada' : 'tarefas não programadas'}`;
}

function updateDemoFilterLabel() {
  const label = document.getElementById('calendar-category-filter-label');
  const button = document.getElementById('calendar-category-filter');
  if (!label || !button) return;

  const categories = getDemoCategories();
  if (demoCategoryFilter === null) {
    label.textContent = 'Todas as categorias';
    button.classList.remove('active');
  } else {
    label.textContent = `${demoCategoryFilter.size} de ${categories.length} categorias`;
    button.classList.add('active');
  }
}

function renderDemoCategoryOptions() {
  if (!isDemoMode()) return;
  const container = document.getElementById('calendar-category-options');
  if (!container) return;

  const categories = getDemoCategories();
  container.innerHTML = '';

  if (!categories.length) {
    container.innerHTML = '<div class="calendar-empty-day">Nenhuma categoria cadastrada.</div>';
    return;
  }

  categories.forEach(category => {
    const label = document.createElement('label');
    label.className = 'calendar-category-option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = demoCategoryFilter === null || demoCategoryFilter.has(category);

    const span = document.createElement('span');
    span.textContent = category;
    label.append(input, span);

    input.addEventListener('change', () => {
      if (demoCategoryFilter === null) demoCategoryFilter = new Set(categories);
      if (input.checked) demoCategoryFilter.add(category);
      else demoCategoryFilter.delete(category);

      if (demoCategoryFilter.size === categories.length && categories.every(item => demoCategoryFilter.has(item))) {
        demoCategoryFilter = null;
      }

      saveDemoFilter();
      updateDemoFilterLabel();
      queueRender();
    });

    container.appendChild(label);
  });
}

function renderDemoCalendar() {
  renderQueued = false;
  if (!isDemoMode()) return;
  renderDayCells();
  renderSelectedDay();
  renderUnprogrammedCount();
  updateDemoFilterLabel();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(renderDemoCalendar);
}

function bindGridObserver() {
  const grid = document.getElementById('calendar-grid');
  if (!grid || grid.dataset.demoObserverBound === 'true') return;
  grid.dataset.demoObserverBound = 'true';

  gridObserver?.disconnect();
  gridObserver = new MutationObserver(() => queueRender());
  gridObserver.observe(grid, { childList: true });
}

document.addEventListener(DEMO_EVENT, event => {
  demoActivities = Array.isArray(event.detail?.activities)
    ? event.detail.activities.map(item => ({ ...item }))
    : [];
  bindGridObserver();
  renderDemoCategoryOptions();
  queueRender();
});

document.addEventListener('rotinaos:calendar-open', () => {
  if (!isDemoMode()) return;
  bindGridObserver();
  window.setTimeout(queueRender, 0);
});

document.addEventListener('click', event => {
  if (!isDemoMode()) return;

  if (event.target?.closest?.('#calendar-grid .calendar-day[data-date], #calendar-prev-month, #calendar-next-month, #calendar-month-picker-trigger')) {
    window.setTimeout(queueRender, 0);
  }

  if (event.target?.closest?.('#calendar-category-filter')) {
    window.setTimeout(() => {
      renderDemoCategoryOptions();
      updateDemoFilterLabel();
    }, 0);
  }

  if (event.target?.closest?.('#calendar-filter-show-all')) {
    demoCategoryFilter = null;
    saveDemoFilter();
    window.setTimeout(() => {
      renderDemoCategoryOptions();
      queueRender();
    }, 0);
  }

  if (event.target?.closest?.('#calendar-filter-hide-all')) {
    demoCategoryFilter = new Set();
    saveDemoFilter();
    window.setTimeout(() => {
      renderDemoCategoryOptions();
      queueRender();
    }, 0);
  }
}, true);

// Se o evento de demo ocorreu antes deste módulo terminar de carregar, recupera
// a cópia publicada pelo bootstrap.
if (isDemoMode() && Array.isArray(window.__ROTINAOS_DEMO_ACTIVITIES__)) {
  demoActivities = window.__ROTINAOS_DEMO_ACTIVITIES__.map(item => ({ ...item }));
  window.setTimeout(() => {
    bindGridObserver();
    renderDemoCategoryOptions();
    queueRender();
  }, 0);
}
