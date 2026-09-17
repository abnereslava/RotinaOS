const DEMO_EVENT = 'rotinaos:demo-activities';
const SENTINEL_DATE = '2099-12-31';

let demoActivities = [];
let gridObserver = null;
let renderQueued = false;

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
  if (activity.recurrence === 'single') return Boolean(activity.scheduledDate && activity.scheduledDate !== SENTINEL_DATE);
  if (activity.recurrence === 'daily') return true;
  if (activity.recurrence === 'weekly') return Array.isArray(activity.fixedDays) && activity.fixedDays.length > 0;
  if (activity.recurrence === 'monthly') return parseMonthlyDays(activity.monthlyDays).length > 0;
  return false;
}

function renderUnprogrammedCount() {
  const element = document.getElementById('calendar-unprogrammed');
  if (!element) return;
  const count = demoActivities.filter(activity => !hasAnyFutureOccurrence(activity)).length;
  element.textContent = `+${count} ${count === 1 ? 'tarefa não programada' : 'tarefas não programadas'}`;
}

function renderDemoCalendar() {
  renderQueued = false;
  if (!isDemoMode()) return;
  renderDayCells();
  renderSelectedDay();
  renderUnprogrammedCount();
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

function readNewActivityFromForm() {
  const title = document.getElementById('act-title')?.value.trim();
  const category = document.getElementById('act-category')?.value.trim();
  if (!title || !category) return null;

  const recurrence = document.getElementById('act-recurrence')?.value || 'single';
  let scheduledDate = document.getElementById('act-date')?.value || null;
  if (scheduledDate === SENTINEL_DATE) scheduledDate = null;

  return {
    id: `demo-bridge-${Date.now()}`,
    title,
    category,
    recurrence,
    scheduledDate,
    scheduledTime: document.getElementById('act-time')?.value || null,
    scheduledTimeEnd: document.getElementById('act-time-end')?.value || null,
    fixedDays: [...document.querySelectorAll('#act-fixed-days input:checked')].map(input => Number(input.value)),
    monthlyDays: document.getElementById('act-monthly-days')?.value || '',
    priority: document.getElementById('act-priority')?.value || '0',
    deadline: document.getElementById('act-deadline')?.value || null,
    status: 'pending',
    createdAt: Date.now()
  };
}

document.addEventListener(DEMO_EVENT, event => {
  demoActivities = Array.isArray(event.detail?.activities)
    ? event.detail.activities.map(item => ({ ...item }))
    : [];
  bindGridObserver();
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
}, true);

document.addEventListener('submit', event => {
  if (!isDemoMode() || event.target?.id !== 'form-activity') return;

  const title = document.getElementById('modal-activity-title')?.textContent || '';
  if (/editar/i.test(title)) {
    window.setTimeout(queueRender, 0);
    return;
  }

  const activity = readNewActivityFromForm();
  if (!activity) return;
  demoActivities.push(activity);
  window.__ROTINAOS_DEMO_ACTIVITIES__ = demoActivities.map(item => ({ ...item }));
  window.setTimeout(queueRender, 0);
}, true);

// Se o evento de demo ocorreu antes deste módulo terminar de carregar, recupera
// a cópia publicada pelo bootstrap.
if (isDemoMode() && Array.isArray(window.__ROTINAOS_DEMO_ACTIVITIES__)) {
  demoActivities = window.__ROTINAOS_DEMO_ACTIVITIES__.map(item => ({ ...item }));
  window.setTimeout(() => {
    bindGridObserver();
    queueRender();
  }, 0);
}
