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
const FILTER_KEY = 'rotinaos.calendar.categoryFilter.v1';
const ANIMATION_MS = 280;
const WEEKDAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

let activities = [];
let occurrences = [];
let unsubscribeActivities = null;
let unsubscribeOccurrences = null;
let viewYear = null;
let viewMonth = null;
let selectedDate = null;
let currentWindowSignature = '';
let categoryFilter = loadCategoryFilter(); // null = todas; Set = somente selecionadas

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

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthIndex(year, month) {
  return year * 12 + month;
}

function monthFromIndex(index) {
  return { year: Math.floor(index / 12), month: index % 12 };
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

  const idx = monthIndex(viewYear, viewMonth);
  if (idx < windowInfo.minIndex) {
    viewYear = windowInfo.minYear;
    viewMonth = windowInfo.minMonth;
  } else if (idx > windowInfo.maxIndex) {
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
    String(value).split(',')
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
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
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
  if (activity.recurrence === 'weekly') return parseFixedDays(activity.fixedDays).includes(date.getDay());
  if (activity.recurrence === 'monthly') return parseMonthlyDays(activity.monthlyDays).includes(date.getDate());
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

function normalizeCategory(value) {
  const text = String(value || '').trim();
  return text || 'Sem categoria';
}

function loadCategoryFilter() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
    if (!saved || saved.mode === 'all') return null;
    if (saved.mode === 'selected' && Array.isArray(saved.categories)) {
      return new Set(saved.categories.map(normalizeCategory));
    }
  } catch (error) {
    console.warn('Filtro do calendário inválido; usando todas as categorias.', error);
  }
  return null;
}

function saveCategoryFilter() {
  if (categoryFilter === null) {
    localStorage.setItem(FILTER_KEY, JSON.stringify({ mode: 'all' }));
    return;
  }
  localStorage.setItem(FILTER_KEY, JSON.stringify({
    mode: 'selected',
    categories: [...categoryFilter].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }));
}

function getKnownCategories() {
  const set = new Set();
  activities.forEach(item => set.add(normalizeCategory(item.category)));
  occurrences.forEach(item => set.add(normalizeCategory(item.category)));
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function categoryIsVisible(item) {
  if (categoryFilter === null) return true;
  return categoryFilter.has(normalizeCategory(item.category));
}

function getOccurrenceRecord(activityId, dateKey) {
  return occurrences.find(item => item.activityId === activityId && item.date === dateKey) || null;
}

function getActivitiesForDate(dateKey) {
  const windowInfo = getCalendarWindow();
  if (dateKey < windowInfo.historyStartKey || dateKey > windowInfo.maxDateKey) return [];

  const source = dateKey < windowInfo.todayKey
    ? occurrences.filter(item => item.date === dateKey)
    : activities.filter(activity => occursOn(activity, dateKey));

  return source
    .filter(categoryIsVisible)
    .sort((a, b) => {
      const timeA = a.scheduledTime || '99:99';
      const timeB = b.scheduledTime || '99:99';
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
    });
}

function getOccurrenceStatus(activity, dateKey) {
  if (activity.date === dateKey && activity.activityId) return activity.status || 'unknown';
  const saved = getOccurrenceRecord(activity.id, dateKey);
  if (saved?.status) return saved.status;
  if (activity.completionDate !== dateKey) return 'pending';
  if (activity.status === 'completed') return 'completed';
  if (activity.status === 'partial') return 'partial';
  return 'pending';
}

function formatSelectedDate(dateKey) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  }).format(parseDateKey(dateKey));
}

function formatMonthTitle(year, month) {
  return `${MONTH_NAMES[month]} ${year}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function injectDesktopCalendarButton() {
  if (document.getElementById('btn-calendar-view')) return;
  const controls = document.querySelector('#main-header .header-controls');
  if (!controls) return;

  const button = document.createElement('button');
  button.id = 'btn-calendar-view';
  button.className = 'btn-icon calendar-desktop-launch';
  button.type = 'button';
  button.title = 'Calendário';
  button.setAttribute('aria-label', 'Abrir calendário');
  button.innerHTML = '<i class="far fa-calendar-alt"></i>';

  const bankButton = document.getElementById('btn-full-view');
  if (bankButton?.parentNode === controls) controls.insertBefore(button, bankButton);
  else controls.appendChild(button);

  button.addEventListener('click', openCalendarAnimated);
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
        <button id="calendar-month-picker-trigger" class="calendar-month-title-wrap" type="button" aria-label="Escolher mês e ano">
          <strong id="calendar-month-title"></strong>
          <span id="calendar-horizon-label"></span>
        </button>
        <button id="calendar-next-month" class="btn-icon calendar-nav-button" type="button" aria-label="Próximo mês">
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>

      <div class="calendar-filter-row">
        <button id="calendar-category-filter" class="calendar-filter-button" type="button">
          <i class="fas fa-filter"></i>
          <span id="calendar-category-filter-label">Todas as categorias</span>
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

      <button id="calendar-unprogrammed" class="calendar-unprogrammed" type="button"></button>
    </div>
  `;

  document.body.appendChild(screen);

  document.getElementById('calendar-prev-month')?.addEventListener('click', () => changeMonth(-1));
  document.getElementById('calendar-next-month')?.addEventListener('click', () => changeMonth(1));
  document.getElementById('calendar-month-picker-trigger')?.addEventListener('click', openMonthPicker);
  document.getElementById('calendar-category-filter')?.addEventListener('click', openCategoryFilter);
  document.getElementById('calendar-unprogrammed')?.addEventListener('click', openActivityBankFromCalendar);
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

function createMonthPicker() {
  if (document.getElementById('calendar-month-picker-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'calendar-month-picker-modal';
  overlay.className = 'calendar-control-modal hidden';
  overlay.innerHTML = `
    <div class="calendar-control-card" role="dialog" aria-modal="true" aria-labelledby="calendar-picker-title">
      <div class="calendar-control-header">
        <div>
          <span class="calendar-detail-kicker">NAVEGAR</span>
          <h3 id="calendar-picker-title">Escolher mês</h3>
        </div>
        <button type="button" class="btn-icon" data-close-calendar-control><i class="fas fa-times"></i></button>
      </div>
      <select id="calendar-picker-year" class="calendar-year-select"></select>
      <div id="calendar-picker-months" class="calendar-picker-months"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('[data-close-calendar-control]')) closeControlModal(overlay);
  });
  document.getElementById('calendar-picker-year')?.addEventListener('change', event => {
    renderMonthPickerMonths(Number(event.target.value));
  });
}

function createCategoryFilterModal() {
  if (document.getElementById('calendar-category-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'calendar-category-modal';
  overlay.className = 'calendar-control-modal hidden';
  overlay.innerHTML = `
    <div class="calendar-control-card" role="dialog" aria-modal="true" aria-labelledby="calendar-filter-title">
      <div class="calendar-control-header">
        <div>
          <span class="calendar-detail-kicker">FILTRO</span>
          <h3 id="calendar-filter-title">Categorias</h3>
        </div>
        <button type="button" class="btn-icon" data-close-calendar-control><i class="fas fa-times"></i></button>
      </div>
      <div class="calendar-filter-actions">
        <button id="calendar-filter-show-all" type="button" class="btn-secondary">MOSTRAR TODAS</button>
        <button id="calendar-filter-hide-all" type="button" class="btn-secondary">OCULTAR TODAS</button>
      </div>
      <div id="calendar-category-options" class="calendar-category-options"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('[data-close-calendar-control]')) closeControlModal(overlay);
  });
  document.getElementById('calendar-filter-show-all')?.addEventListener('click', () => {
    categoryFilter = null;
    saveCategoryFilter();
    renderCategoryOptions();
    renderCalendar();
  });
  document.getElementById('calendar-filter-hide-all')?.addEventListener('click', () => {
    categoryFilter = new Set();
    saveCategoryFilter();
    renderCategoryOptions();
    renderCalendar();
  });
}

function closeControlModal(modal) {
  modal?.classList.add('hidden');
}

function openMonthPicker() {
  createMonthPicker();
  const windowInfo = getCalendarWindow();
  const select = document.getElementById('calendar-picker-year');
  const modal = document.getElementById('calendar-month-picker-modal');
  if (!select || !modal) return;

  select.innerHTML = '';
  for (let year = windowInfo.minYear; year <= windowInfo.maxYear; year += 1) {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = String(year);
    option.selected = year === viewYear;
    select.appendChild(option);
  }
  renderMonthPickerMonths(viewYear);
  modal.classList.remove('hidden');
}

function renderMonthPickerMonths(year) {
  const container = document.getElementById('calendar-picker-months');
  if (!container) return;
  const windowInfo = getCalendarWindow();
  container.innerHTML = '';

  MONTH_NAMES.forEach((name, month) => {
    const idx = monthIndex(year, month);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar-picker-month';
    button.textContent = name.slice(0, 3).toUpperCase();
    button.disabled = idx < windowInfo.minIndex || idx > windowInfo.maxIndex;
    if (year === viewYear && month === viewMonth) button.classList.add('active');
    button.addEventListener('click', () => {
      if (button.disabled) return;
      viewYear = year;
      viewMonth = month;
      ensureSelectedDateForCurrentMonth();
      renderCalendar();
      closeControlModal(document.getElementById('calendar-month-picker-modal'));
    });
    container.appendChild(button);
  });
}

function openCategoryFilter() {
  createCategoryFilterModal();
  renderCategoryOptions();
  document.getElementById('calendar-category-modal')?.classList.remove('hidden');
}

function renderCategoryOptions() {
  const container = document.getElementById('calendar-category-options');
  if (!container) return;
  const categories = getKnownCategories();
  container.innerHTML = '';

  if (categories.length === 0) {
    container.innerHTML = '<div class="calendar-empty-day">Nenhuma categoria cadastrada.</div>';
    return;
  }

  categories.forEach(category => {
    const label = document.createElement('label');
    label.className = 'calendar-category-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = categoryFilter === null || categoryFilter.has(category);
    const span = document.createElement('span');
    span.textContent = category;
    label.append(input, span);

    input.addEventListener('change', () => {
      const allCategories = getKnownCategories();
      if (categoryFilter === null) categoryFilter = new Set(allCategories);
      if (input.checked) categoryFilter.add(category);
      else categoryFilter.delete(category);

      if (categoryFilter.size === allCategories.length && allCategories.every(item => categoryFilter.has(item))) {
        categoryFilter = null;
      }
      saveCategoryFilter();
      renderCalendar();
    });

    container.appendChild(label);
  });
}

function updateCategoryFilterLabel() {
  const label = document.getElementById('calendar-category-filter-label');
  const button = document.getElementById('calendar-category-filter');
  if (!label || !button) return;
  const total = getKnownCategories().length;
  if (categoryFilter === null) {
    label.textContent = 'Todas as categorias';
    button.classList.remove('active');
  } else {
    label.textContent = `${categoryFilter.size} de ${total} categorias`;
    button.classList.add('active');
  }
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

function animateElement(element, fromX, toX, onDone) {
  if (!element) return;
  element.style.transition = 'none';
  element.style.willChange = 'transform';
  element.style.transform = `translate3d(${fromX}px,0,0)`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    element.style.transition = `transform ${ANIMATION_MS}ms cubic-bezier(0.22,1,0.36,1)`;
    element.style.transform = `translate3d(${toX}px,0,0)`;
    window.setTimeout(() => {
      element.style.transition = '';
      element.style.transform = '';
      element.style.willChange = '';
      onDone?.();
    }, ANIMATION_MS + 50);
  }));
}

function openCalendarAnimated() {
  const screen = createCalendarScreen();
  if (!screen.classList.contains('hidden')) return;
  screen.classList.remove('hidden');
  screen.dispatchEvent(new CustomEvent('rotinaos:calendar-open'));
  animateElement(screen, -window.innerWidth, 0);
}

function openActivityBankFromCalendar() {
  const calendar = document.getElementById('calendar-view');
  const openBank = () => {
    const fullView = document.getElementById('modal-full-view');
    const button = document.getElementById('btn-full-view');
    if (!fullView || !button) return;
    fullView.style.transition = 'none';
    fullView.style.willChange = 'transform';
    fullView.style.transform = `translate3d(${window.innerWidth}px,0,0)`;
    button.click();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fullView.style.transition = `transform ${ANIMATION_MS}ms cubic-bezier(0.22,1,0.36,1)`;
      fullView.style.transform = 'translate3d(0,0,0)';
      window.setTimeout(() => {
        fullView.style.transition = '';
        fullView.style.transform = '';
        fullView.style.willChange = '';
      }, ANIMATION_MS + 50);
    }));
  };

  if (!calendar || calendar.classList.contains('hidden')) {
    openBank();
    return;
  }

  let done = false;
  const afterClose = () => {
    if (done) return;
    done = true;
    calendar.removeEventListener('rotinaos:calendar-close', afterClose);
    openBank();
  };
  calendar.addEventListener('rotinaos:calendar-close', afterClose, { once: true });
  document.dispatchEvent(new CustomEvent('rotinaos:calendar-close-request'));
  window.setTimeout(afterClose, 420);
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

  let done = false;
  const afterClose = () => {
    if (done) return;
    done = true;
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

  document.getElementById('calendar-month-title').textContent = formatMonthTitle(viewYear, viewMonth);
  const horizon = document.getElementById('calendar-horizon-label');
  if (horizon) horizon.textContent = `de ${formatMonthTitle(windowInfo.minYear, windowInfo.minMonth)} a ${formatMonthTitle(windowInfo.maxYear, windowInfo.maxMonth)}`;

  const prev = document.getElementById('calendar-prev-month');
  const next = document.getElementById('calendar-next-month');
  if (prev) prev.disabled = monthIndex(viewYear, viewMonth) <= windowInfo.minIndex;
  if (next) next.disabled = monthIndex(viewYear, viewMonth) >= windowInfo.maxIndex;

  updateCategoryFilterLabel();
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
  for (let i = 0; i < firstDay.getDay(); i += 1) {
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
    if (dayActivities.length) cell.classList.add('has-tasks');

    const completed = dayActivities.filter(item => getOccurrenceStatus(item, key) === 'completed').length;
    const partial = dayActivities.filter(item => getOccurrenceStatus(item, key) === 'partial').length;

    cell.innerHTML = `
      <span class="calendar-day-number">${day}</span>
      ${dayActivities.length ? `<span class="calendar-task-count">${dayActivities.length}</span>` : ''}
      ${completed || partial ? `<span class="calendar-status-dots" aria-hidden="true">
        ${completed ? '<i class="status-dot completed"></i>' : ''}
        ${partial ? '<i class="status-dot partial"></i>' : ''}
      </span>` : ''}
    `;

    cell.addEventListener('click', () => {
      selectedDate = key;
      renderMonthGrid(windowInfo);
      renderSelectedDay();
      if (!isPast) openNewActivityForDate(key);
    });
    grid.appendChild(cell);
  }

  const remainder = grid.children.length % 7;
  if (remainder) {
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

  if (!dayActivities.length) {
    list.innerHTML = '<div class="calendar-empty-day">Nenhuma tarefa desta seleção para este dia.</div>';
    return;
  }

  dayActivities.forEach(activity => {
    const status = getOccurrenceStatus(activity, selectedDate);
    const recurrenceLabel = { single: 'Única', daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal' }[activity.recurrence] || 'Atividade';
    const statusLabel = status === 'completed' ? 'Concluída' : status === 'partial' ? 'Parcial' : status === 'unknown' ? 'Sem registro' : 'Pendente';
    const item = document.createElement('div');
    item.className = `calendar-task-row status-${status}`;
    item.innerHTML = `
      <div class="calendar-task-time">${escapeHtml(activity.scheduledTime || 'Sem horário')}</div>
      <div class="calendar-task-main">
        <strong>${escapeHtml(activity.title || 'Sem título')}</strong>
        <span>${escapeHtml(normalizeCategory(activity.category))} · ${recurrenceLabel} · ${statusLabel}</span>
      </div>
    `;
    list.appendChild(item);
  });
}

function renderUnprogrammedCount(windowInfo) {
  const element = document.getElementById('calendar-unprogrammed');
  if (!element) return;
  const count = activities
    .filter(categoryIsVisible)
    .filter(activity => !activityHasOccurrenceInWindow(activity, windowInfo))
    .length;
  element.textContent = `+${count} ${count === 1 ? 'tarefa não programada' : 'tarefas não programadas'}`;
  element.title = 'Abrir Banco de Atividades';
}

createCalendarScreen();
createMonthPicker();
createCategoryFilterModal();
injectDesktopCalendarButton();
syncWindow({ forceCurrentMonth: true });
ensureSelectedDateForCurrentMonth();
renderCalendar();

onAuthStateChanged(auth, user => {
  unsubscribeActivities?.();
  unsubscribeOccurrences?.();
  unsubscribeActivities = null;
  unsubscribeOccurrences = null;

  if (!user) {
    activities = [];
    occurrences = [];
    renderCalendar();
    return;
  }

  unsubscribeActivities = onSnapshot(
    query(collection(db, 'activities'), where('userId', '==', user.uid)),
    snapshot => {
      activities = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      renderCalendar();
      renderCategoryOptions();
    },
    error => console.error('Falha ao carregar atividades do calendário:', error)
  );

  unsubscribeOccurrences = onSnapshot(
    query(collection(db, 'activity_occurrences'), where('userId', '==', user.uid)),
    snapshot => {
      occurrences = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      renderCalendar();
      renderCategoryOptions();
    },
    error => console.error('Falha ao carregar histórico do calendário:', error)
  );
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
  if (document.visibilityState !== 'visible') return;
  injectDesktopCalendarButton();
  const before = currentWindowSignature;
  syncWindow();
  if (before !== currentWindowSignature) {
    ensureSelectedDateForCurrentMonth();
    renderCalendar();
  }
});
