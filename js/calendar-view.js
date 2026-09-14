import { getApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const firebaseApp = getApp();
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const HORIZON_MONTHS = 24;
const HISTORY_MONTHS = 1;
const WEEKDAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

let activities = [];
let occurrences = [];
let unsubscribeActivities = null;
let unsubscribeOccurrences = null;
let viewYear = null;
let viewMonth = null;
let selectedDate = null;
let currentWindowSignature = '';

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
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthIndex(year, month) {
  return year * 12 + month;
}

function monthFromIndex(index) {
  return {
    year: Math.floor(index / 12),
    month: index % 12
  };
}

function getCalendarWindow() {
  const todayKey = getTodayString();
  const today = parseDateKey(todayKey);
  const currentIndex = monthIndex(today.getFullYear(), today.getMonth());
  const minIndex = currentIndex - HISTORY_MONTHS;
  const maxIndex = currentIndex + HORIZON_MONTHS;
  const minParts = monthFromIndex(minIndex);
  const maxParts = monthFromIndex(maxIndex);
  const historyStart = new Date(minParts.year, minParts.month, 1);
  const maxDate = new Date(maxParts.year, maxParts.month + 1, 0);

  return {
    todayKey,
    today,
    currentIndex,
    currentYear: today.getFullYear(),
    currentMonth: today.getMonth(),
    minIndex,
    maxIndex,
    historyStartKey: toDateKey(historyStart),
    maxDateKey: toDateKey(maxDate),
    minYear: minParts.year,
    minMonth: minParts.month,
    maxYear: maxParts.year,
    maxMonth: maxParts.month
  };
}

function syncWindow({ forceCurrentMonth = false } = {}) {
  const windowInfo = getCalendarWindow();
  const signature = `${windowInfo.todayKey.slice(0, 7)}:${windowInfo.historyStartKey.slice(0, 7)}:${windowInfo.maxDateKey.slice(0, 7)}`;
  const changed = signature !== currentWindowSignature;
  currentWindowSignature = signature;

  if (viewYear === null || viewMonth === null || forceCurrentMonth) {
    viewYear = windowInfo.currentYear;
    viewMonth = windowInfo.currentMonth;
  }

  const currentViewIndex = monthIndex(viewYear, viewMonth);
  if (currentViewIndex < windowInfo.minIndex) {
    viewYear = windowInfo.minYear;
    viewMonth = windowInfo.minMonth;
  } else if (currentViewIndex > windowInfo.maxIndex) {
    viewYear = windowInfo.maxYear;
    viewMonth = windowInfo.maxMonth;
  }

  if (changed && selectedDate && selectedDate < windowInfo.historyStartKey) {
    selectedDate = windowInfo.todayKey;
  }

  return windowInfo;
}

function parseMonthlyDays(value) {
  if (!value) return [];
  return [...new Set(
    String(value)
      .split(',')
      .map(item => Number.parseInt(item.trim(), 10))
      .filter(day => Number.isInteger(day) && day >= 1 && day <= 31)
  )];
}

function parseFixedDays(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
}

function getActivityCreatedDateKey(activity) {
  const raw = activity?.createdAt;
  if (!raw) return null;

  let date = null;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  } else if (typeof raw?.toDate === 'function') {
    date = raw.toDate();
  }

  if (!date || Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function occursOn(activity, dateKey) {
  const createdDate = getActivityCreatedDateKey(activity);
  if (createdDate && dateKey < createdDate) return false;

  const date = parseDateKey(dateKey);

  if (activity.recurrence === 'single') {
    return Boolean(activity.scheduledDate && activity.scheduledDate === dateKey);
  }

  if (activity.recurrence === 'daily') return true;

  if (activity.recurrence === 'weekly') {
    return parseFixedDays(activity.fixedDays).includes(date.getDay());
  }

  if (activity.recurrence === 'monthly') {
    return parseMonthlyDays(activity.monthlyDays).includes(date.getDate());
  }

  return false;
}

function activityHasOccurrenceInWindow(activity, windowInfo) {
  if (activity.recurrence === 'single') {
    return Boolean(
      activity.scheduledDate &&
      activity.scheduledDate >= windowInfo.todayKey &&
      activity.scheduledDate <= windowInfo.maxDateKey
    );
  }

  if (activity.recurrence === 'daily') return true;
  if (activity.recurrence === 'weekly') return parseFixedDays(activity.fixedDays).length > 0;
  if (activity.recurrence === 'monthly') return parseMonthlyDays(activity.monthlyDays).length > 0;

  return false;
}

function getOccurrenceRecord(activityId, dateKey) {
  return occurrences.find(item => item.activityId === activityId && item.date === dateKey) || null;
}

function getActivitiesForDate(dateKey) {
  const windowInfo = getCalendarWindow();
  if (dateKey < windowInfo.historyStartKey || dateKey > windowInfo.maxDateKey) return [];

  // Datas passadas são lidas do histórico persistido para não serem reescritas por mudanças futuras na atividade.
  if (dateKey < windowInfo.todayKey) {
    return occurrences
      .filter(item => item.date === dateKey)
      .sort((a, b) => {
        const timeA = a.scheduledTime || '99:99';
        const timeB = b.scheduledTime || '99:99';
        if (timeA !== timeB) return timeA.localeCompare(timeB);
        return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
      });
  }

  return activities
    .filter(activity => occursOn(activity, dateKey))
    .sort((a, b) => {
      const timeA = a.scheduledTime || '99:99';
      const timeB = b.scheduledTime || '99:99';
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
    });
}

function getOccurrenceStatus(activity, dateKey) {
  if (activity.date === dateKey && activity.activityId) {
    return activity.status || 'unknown';
  }

  const savedOccurrence = getOccurrenceRecord(activity.id, dateKey);
  if (savedOccurrence?.status) return savedOccurrence.status;

  if (activity.completionDate !== dateKey) return 'pending';
  if (activity.status === 'completed') return 'completed';
  if (activity.status === 'partial') return 'partial';
  return 'pending';
}

function formatSelectedDate(dateKey) {
  if (!dateKey) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(parseDateKey(dateKey));
}

function formatMonthTitle(year, month) {
  const text = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric'
  }).format(new Date(year, month, 1));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function createCalendarScreen() {
  if (document.getElementById('calendar-view')) return document.getElementById('calendar-view');

  const screen = document.createElement('section');
  screen.id = 'calendar-view';
  screen.className = 'calendar-view hidden';
  screen.setAttribute('aria-label', 'Calendário');
  screen.innerHTML = `
    <header class="calendar-header">
      <div>
        <div class="calendar-kicker">PLANEJAMENTO</div>
        <h2><i class="far fa-calendar-alt"></i> Calendário</h2>
      </div>
      <button id="btn-close-calendar" class="btn-icon calendar-close" type="button" aria-label="Fechar calendário">
        <i class="fas fa-times"></i>
      </button>
    </header>

    <div class="calendar-scroll-area">
      <div class="calendar-month-toolbar">
        <button id="calendar-prev-month" class="btn-icon calendar-nav-button" type="button" aria-label="Mês anterior">
          <i class="fas fa-chevron-left"></i>
        </button>
        <div class="calendar-month-title-wrap">
          <strong id="calendar-month-title"></strong>
          <span id="calendar-horizon-label"></span>
        </div>
        <button id="calendar-next-month" class="btn-icon calendar-nav-button" type="button" aria-label="Próximo mês">
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>

      <div class="calendar-card">
        <div class="calendar-weekdays">
          ${WEEKDAY_LABELS.map(label => `<span>${label}</span>`).join('')}
        </div>
        <div id="calendar-grid" class="calendar-grid"></div>
      </div>

      <section class="calendar-day-details" aria-live="polite">
        <div class="calendar-day-details-header">
          <div>
            <span class="calendar-detail-kicker">TAREFAS DO DIA</span>
            <h3 id="calendar-selected-date"></h3>
          </div>
          <span id="calendar-selected-count" class="calendar-selected-count"></span>
        </div>
        <div id="calendar-selected-tasks" class="calendar-selected-tasks"></div>
      </section>

      <div id="calendar-unprogrammed" class="calendar-unprogrammed"></div>
    </div>
  `;

  document.body.appendChild(screen);

  document.getElementById('calendar-prev-month')?.addEventListener('click', () => changeMonth(-1));
  document.getElementById('calendar-next-month')?.addEventListener('click', () => changeMonth(1));
  document.getElementById('btn-close-calendar')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('rotinaos:calendar-close-request'));
  });

  screen.addEventListener('rotinaos:calendar-open', () => {
    syncWindow();
    ensureSelectedDateForCurrentMonth();
    renderCalendar();
  });

  return screen;
}

function ensureSelectedDateForCurrentMonth() {
  const windowInfo = syncWindow();
  const currentMonthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;

  if (selectedDate?.startsWith(currentMonthKey)) return;

  if (viewYear === windowInfo.currentYear && viewMonth === windowInfo.currentMonth) {
    selectedDate = windowInfo.todayKey;
    return;
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (getActivitiesForDate(key).length > 0) {
      selectedDate = key;
      return;
    }
  }

  selectedDate = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
}

function changeMonth(delta) {
  const windowInfo = syncWindow();
  const nextIndex = monthIndex(viewYear, viewMonth) + delta;
  if (nextIndex < windowInfo.minIndex || nextIndex > windowInfo.maxIndex) return;

  const next = monthFromIndex(nextIndex);
  viewYear = next.year;
  viewMonth = next.month;
  ensureSelectedDateForCurrentMonth();
  renderCalendar();
}

function openNewActivityForDate(dateKey) {
  const windowInfo = getCalendarWindow();
  if (dateKey < windowInfo.todayKey) return;

  const calendar = document.getElementById('calendar-view');
  const openForm = () => {
    const button = document.getElementById('btn-new-activity');
    if (!button) return;

    button.click();

    window.setTimeout(() => {
      const recurrence = document.getElementById('act-recurrence');
      const dateInput = document.getElementById('act-date');

      if (recurrence) {
        recurrence.value = 'single';
        recurrence.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (dateInput) {
        dateInput.value = dateKey;
        dateInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 0);
  };

  if (!calendar || calendar.classList.contains('hidden')) {
    openForm();
    return;
  }

  let opened = false;
  const afterClose = () => {
    if (opened) return;
    opened = true;
    calendar.removeEventListener('rotinaos:calendar-close', afterClose);
    openForm();
  };

  calendar.addEventListener('rotinaos:calendar-close', afterClose, { once: true });
  document.dispatchEvent(new CustomEvent('rotinaos:calendar-close-request'));
  window.setTimeout(afterClose, 420);
}

function renderCalendar() {
  const screen = createCalendarScreen();
  const windowInfo = syncWindow();
  if (!screen) return;

  const title = document.getElementById('calendar-month-title');
  if (title) title.textContent = formatMonthTitle(viewYear, viewMonth);

  const horizon = document.getElementById('calendar-horizon-label');
  if (horizon) {
    horizon.textContent = `histórico desde ${formatMonthTitle(windowInfo.minYear, windowInfo.minMonth)} · até ${formatMonthTitle(windowInfo.maxYear, windowInfo.maxMonth)}`;
  }

  const prevButton = document.getElementById('calendar-prev-month');
  const nextButton = document.getElementById('calendar-next-month');
  if (prevButton) prevButton.disabled = monthIndex(viewYear, viewMonth) <= windowInfo.minIndex;
  if (nextButton) nextButton.disabled = monthIndex(viewYear, viewMonth) >= windowInfo.maxIndex;

  renderMonthGrid(windowInfo);
  renderSelectedDay();
  renderUnprogrammedCount(windowInfo);
}

function renderMonthGrid(windowInfo) {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const firstDay = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadingBlankCount = firstDay.getDay();

  for (let i = 0; i < leadingBlankCount; i += 1) {
    const blank = document.createElement('div');
    blank.className = 'calendar-day calendar-day-blank';
    grid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isPast = key < windowInfo.todayKey;
    const dayActivities = getActivitiesForDate(key);

    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    cell.dataset.date = key;
    if (isPast) cell.classList.add('is-past');
    if (key === windowInfo.todayKey) cell.classList.add('is-today');
    if (key === selectedDate) cell.classList.add('is-selected');
    if (dayActivities.length > 0) cell.classList.add('has-tasks');

    const completedCount = dayActivities.filter(activity => getOccurrenceStatus(activity, key) === 'completed').length;
    const partialCount = dayActivities.filter(activity => getOccurrenceStatus(activity, key) === 'partial').length;

    cell.innerHTML = `
      <span class="calendar-day-number">${day}</span>
      ${dayActivities.length > 0 ? `<span class="calendar-task-count">${dayActivities.length}</span>` : ''}
      ${completedCount > 0 || partialCount > 0 ? `
        <span class="calendar-status-dots" aria-hidden="true">
          ${completedCount > 0 ? '<i class="status-dot completed"></i>' : ''}
          ${partialCount > 0 ? '<i class="status-dot partial"></i>' : ''}
        </span>
      ` : ''}
    `;

    cell.addEventListener('click', () => {
      selectedDate = key;
      renderMonthGrid(windowInfo);
      renderSelectedDay();

      // Histórico é apenas consulta. Hoje e futuro abrem o cadastro já com a data escolhida.
      if (!isPast) openNewActivityForDate(key);
    });

    grid.appendChild(cell);
  }

  const remainder = grid.children.length % 7;
  if (remainder !== 0) {
    for (let i = remainder; i < 7; i += 1) {
      const blank = document.createElement('div');
      blank.className = 'calendar-day calendar-day-blank';
      grid.appendChild(blank);
    }
  }
}

function renderSelectedDay() {
  const title = document.getElementById('calendar-selected-date');
  const count = document.getElementById('calendar-selected-count');
  const list = document.getElementById('calendar-selected-tasks');
  if (!title || !count || !list || !selectedDate) return;

  const dayActivities = getActivitiesForDate(selectedDate);
  title.textContent = formatSelectedDate(selectedDate);
  count.textContent = String(dayActivities.length);
  list.innerHTML = '';

  if (dayActivities.length === 0) {
    list.innerHTML = '<div class="calendar-empty-day">Nenhuma tarefa programada para este dia.</div>';
    return;
  }

  dayActivities.forEach(activity => {
    const status = getOccurrenceStatus(activity, selectedDate);
    const item = document.createElement('div');
    item.className = `calendar-task-row status-${status}`;

    const recurrenceLabel = {
      single: 'Única',
      daily: 'Diária',
      weekly: 'Semanal',
      monthly: 'Mensal'
    }[activity.recurrence] || 'Atividade';

    const timeLabel = activity.scheduledTime || 'Sem horário';
    const statusLabel = status === 'completed'
      ? 'Concluída'
      : status === 'partial'
        ? 'Parcial'
        : status === 'unknown'
          ? 'Sem registro'
          : 'Pendente';

    item.innerHTML = `
      <div class="calendar-task-time">${timeLabel}</div>
      <div class="calendar-task-main">
        <strong>${escapeHtml(activity.title || 'Sem título')}</strong>
        <span>${escapeHtml(activity.category || 'Sem categoria')} · ${recurrenceLabel} · ${statusLabel}</span>
      </div>
    `;

    list.appendChild(item);
  });
}

function renderUnprogrammedCount(windowInfo) {
  const element = document.getElementById('calendar-unprogrammed');
  if (!element) return;

  const count = activities.filter(activity => !activityHasOccurrenceInWindow(activity, windowInfo)).length;
  element.textContent = `+${count} ${count === 1 ? 'tarefa não programada' : 'tarefas não programadas'}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

createCalendarScreen();
syncWindow({ forceCurrentMonth: true });
ensureSelectedDateForCurrentMonth();
renderCalendar();

onAuthStateChanged(auth, user => {
  if (unsubscribeActivities) {
    unsubscribeActivities();
    unsubscribeActivities = null;
  }
  if (unsubscribeOccurrences) {
    unsubscribeOccurrences();
    unsubscribeOccurrences = null;
  }

  if (!user) {
    activities = [];
    occurrences = [];
    renderCalendar();
    return;
  }

  const activitiesQuery = query(
    collection(db, 'activities'),
    where('userId', '==', user.uid)
  );

  const occurrencesQuery = query(
    collection(db, 'activity_occurrences'),
    where('userId', '==', user.uid)
  );

  unsubscribeActivities = onSnapshot(activitiesQuery, snapshot => {
    activities = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderCalendar();
  }, error => {
    console.error('Falha ao carregar atividades do calendário:', error);
  });

  unsubscribeOccurrences = onSnapshot(occurrencesQuery, snapshot => {
    occurrences = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderCalendar();
  }, error => {
    console.error('Falha ao carregar histórico do calendário:', error);
  });
});

window.setInterval(() => {
  const before = currentWindowSignature;
  syncWindow();
  if (before !== currentWindowSignature) {
    ensureSelectedDateForCurrentMonth();
    renderCalendar();
  }
}, 60 * 60 * 1000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const before = currentWindowSignature;
    syncWindow();
    if (before !== currentWindowSignature) {
      ensureSelectedDateForCurrentMonth();
      renderCalendar();
    }
  }
});
