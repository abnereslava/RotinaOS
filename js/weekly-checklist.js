import { getApp } from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js';
import {
  getFirestore, doc, collection, query, where, onSnapshot, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js';
import {
  todayKey, shiftDate, emptyWeek, isExpired, reconcileTracked, setTracked, beginNewWeek, sortWeekItems
} from './weekly-checklist-model.js';

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const DEMO_KEY = 'rotinaos.weekly.demo.v1';
const SORT_KEY = 'rotinaos.weekly.sort.v1';
const SORT_MODES = new Set(['none', 'priority-desc', 'priority-asc', 'name-asc', 'name-desc', 'category-asc', 'category-desc']);
let sortMode = loadSortMode();
let userId = null;
let state = null;
let activities = [];
let activitiesReady = false;
let unsubscribeWeek = null;
let unsubscribeActivities = null;
let busy = false;
let syncing = false;
let activitiesVersion = 0;
let errorMessage = '';
let mutationQueue = Promise.resolve();
let noticeTimer = null;

function loadSortMode() {
  try {
    const saved = localStorage.getItem(SORT_KEY);
    return SORT_MODES.has(saved) ? saved : 'none';
  } catch (_) { return 'none'; }
}

function demo() { return Boolean(window.__ROTINAOS_DEMO__); }
function active() { return Boolean(userId && state && !isExpired(state)); }
function editable() { return active() && !busy && (demo() || navigator.onLine); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
function formatDate(key) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(`${key}T12:00:00Z`));
}
function reportError(error) {
  console.error('Checklist semanal:', error);
  errorMessage = error?.code === 'permission-denied'
    ? 'Não foi possível acessar sua checklist. O acesso precisa ser configurado pelo administrador do aplicativo.'
    : error.message || 'Não foi possível salvar. Tente novamente.';
  render();
}

function createScreen() {
  const screen = document.createElement('section');
  screen.id = 'weekly-checklist-view';
  screen.className = 'weekly-checklist-view hidden';
  screen.setAttribute('aria-labelledby', 'weekly-heading');
  screen.innerHTML = `
    <header class="calendar-header weekly-header">
      <div><div class="calendar-kicker">PLANEJAMENTO</div><h2 id="weekly-heading">Checklist semanal</h2></div>
      <button id="btn-close-weekly" type="button" class="btn-icon" aria-label="Voltar para hoje" title="Voltar para hoje">×</button>
    </header>
    <div class="weekly-scroll-area">
      <div class="weekly-content">
        <div class="weekly-period"><div><span class="calendar-kicker">SEGUNDA A DOMINGO</span>
          <h3 id="weekly-period"></h3></div><span id="weekly-progress" aria-live="polite"></span></div>
        <p class="weekly-help">Adicione itens abaixo ou pressione e segure uma tarefa no banco para acompanhá-la aqui.</p>
        <p id="weekly-status" role="status" aria-live="polite"></p>
        <form id="weekly-add-form" class="weekly-add-form">
          <label class="weekly-sr-only" for="weekly-new-item">Novo item da semana</label>
          <input id="weekly-new-item" type="text" maxlength="300" placeholder="O que você quer concluir nesta semana?" required autocomplete="off">
          <button type="submit" class="btn-primary">Adicionar</button>
        </form>
        <div class="weekly-sort-control">
          <label for="weekly-sort">Ordenar por</label>
          <select id="weekly-sort">
            <option value="none">Ordem de inclusão</option>
            <option value="priority-desc">Prioridade: alta → baixa</option>
            <option value="priority-asc">Prioridade: baixa → alta</option>
            <option value="name-asc">Nome: A → Z</option>
            <option value="name-desc">Nome: Z → A</option>
            <option value="category-asc">Categoria: A → Z</option>
            <option value="category-desc">Categoria: Z → A</option>
          </select>
        </div>
        <div id="weekly-table-wrap" class="weekly-table-wrap">
          <table class="weekly-table"><caption class="weekly-sr-only">Itens da semana</caption>
            <thead><tr><th scope="col">Feito</th><th scope="col">Item</th><th scope="col"><span class="weekly-sr-only">Ações</span></th></tr></thead>
            <tbody id="weekly-items"></tbody>
          </table>
        </div>
        <button id="weekly-new-week" type="button" class="btn-primary hidden">Começar nova semana</button>
        <p class="weekly-gesture-hint">Arraste para a direita para abrir o calendário. Para a esquerda, volte para hoje.</p>
      </div>
    </div>`;
  document.body.appendChild(screen);
  const dialog = document.createElement('dialog');
  dialog.id = 'weekly-confirm';
  dialog.setAttribute('aria-labelledby', 'weekly-confirm-heading');
  dialog.innerHTML = `<h3 id="weekly-confirm-heading">Concluir no banco de tarefas?</h3>
    <p id="weekly-confirm-message"></p><form method="dialog">
      <button type="submit" value="no" class="btn-secondary" autofocus>Somente na checklist</button>
      <button type="submit" value="yes" class="btn-primary">Sim, concluir tarefa</button>
    </form>`;
  document.body.appendChild(dialog);

  document.getElementById('btn-close-weekly').onclick = closeScreen;
  const sortControl = document.getElementById('weekly-sort');
  sortControl.value = sortMode;
  sortControl.addEventListener('change', () => {
    if (!SORT_MODES.has(sortControl.value)) return;
    sortMode = sortControl.value;
    try { localStorage.setItem(SORT_KEY, sortMode); } catch (_) {}
    render();
  });
  document.getElementById('btn-weekly-checklist')?.addEventListener('click', () => window.RotinaSwipeNavigation?.openWeekly?.());
  screen.addEventListener('rotinaos:weekly-open', () => { render(); syncTracked(); });
  document.getElementById('weekly-add-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.getElementById('weekly-new-item');
    const title = input.value.trim();
    if (!title || !editable()) return;
    try {
      await mutate({ type: 'add', id: `manual_${crypto.randomUUID()}`, title, week: state.weekStart });
      input.value = '';
      input.focus();
    } catch (error) { reportError(error); }
  });
  document.getElementById('weekly-new-week').addEventListener('click', async () => {
    try { await mutate({ type: 'rollover', week: state.weekStart }); }
    catch (error) { reportError(error); }
  });
  document.getElementById('weekly-items').addEventListener('change', async event => {
    const checkbox = event.target.closest('input[data-weekly-id]');
    if (!checkbox) return;
    const item = state?.items.find(entry => entry.id === checkbox.dataset.weeklyId);
    if (!item || !editable()) { render(); return; }
    const done = checkbox.checked;
    const week = state.weekStart;
    try {
      await mutate({ type: 'check', id: item.id, done, week });
      // Desmarcar só altera o acompanhamento semanal; não desfaz a tarefa original.
      const activity = activities.find(entry => entry.id === item.activityId);
      if (!done || !activity) return;
      const confirmed = await askCompletion(item.title);
      if (confirmed) await mutate({ type: 'complete-task', activityId: item.activityId, id: item.id, week });
    } catch (error) { reportError(error); }
  });
  document.getElementById('weekly-items').addEventListener('click', async event => {
    const taskButton = event.target.closest('button[data-open-weekly]');
    if (taskButton) {
      const item = state?.items.find(entry => entry.id === taskButton.dataset.openWeekly);
      if (!item?.activityId || !activities.some(activity => activity.id === item.activityId)) return;
      if (!window.RotinaActivityDetails?.open?.(item.activityId)) {
        reportError(new Error('Não foi possível abrir a tarefa. Tente novamente em instantes.'));
      }
      return;
    }
    const button = event.target.closest('button[data-remove-weekly]');
    if (!button || !editable()) return;
    try { await mutate({ type: 'remove', id: button.dataset.removeWeekly, week: state.weekStart }); }
    catch (error) { reportError(error); }
  });
}

function closeScreen() {
  document.dispatchEvent(new CustomEvent('rotinaos:weekly-close-request'));
}
function askCompletion(title) {
  const dialog = document.getElementById('weekly-confirm');
  document.getElementById('weekly-confirm-message').textContent =
    `“${title}” foi marcada na checklist. Deseja também marcar essa tarefa como concluída no banco de tarefas?`;
  dialog.returnValue = 'no';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true });
    dialog.showModal();
  });
}

function render() {
  const expired = isExpired(state);
  const disabled = !editable();
  const rows = document.getElementById('weekly-items');
  const focused = document.activeElement;
  const focusId = focused?.dataset?.weeklyId || focused?.dataset?.removeWeekly || focused?.dataset?.openWeekly;
  const focusSelector = focused?.dataset?.openWeekly ? '[data-open-weekly]'
    : focused?.dataset?.removeWeekly ? '[data-remove-weekly]' : '[data-weekly-id]';
  document.getElementById('weekly-period').textContent = state
    ? `${formatDate(state.weekStart)} – ${formatDate(shiftDate(state.weekStart, 6))}` : 'Carregando sua semana…';
  const items = state?.items || [];
  document.getElementById('weekly-progress').textContent = state
    ? `${items.filter(item => item.done).length} de ${items.length} concluídos` : '';
  document.getElementById('weekly-new-item').disabled = disabled;
  document.querySelector('#weekly-add-form button').disabled = disabled;
  document.getElementById('weekly-add-form').classList.toggle('hidden', expired);
  const newWeekButton = document.getElementById('weekly-new-week');
  newWeekButton.classList.toggle('hidden', !expired);
  newWeekButton.disabled = busy || (!demo() && !navigator.onLine);
  document.getElementById('weekly-table-wrap').classList.toggle('is-expired', expired);
  document.getElementById('weekly-status').textContent = errorMessage || (
    expired ? 'Semana encerrada. Comece uma nova semana para continuar; os itens pendentes serão mantidos.' :
    (!demo() && !navigator.onLine) ? 'Sem conexão. Conecte-se para alterar a checklist.' : ''
  );
  rows.innerHTML = items.length ? sortWeekItems(items, activities, sortMode).map(item => {
    const source = activities.find(activity => activity.id === item.activityId);
    const title = source?.title || item.title;
    const origin = item.activityId ? (source ? 'Banco de tarefas' : 'Tarefa removida do banco') : 'Adicionado manualmente';
    const category = String(source?.category || '').trim() || 'Sem categoria';
    const priority = Number(source?.priority);
    const priorityLabel = { 1: 'Baixa', 2: 'Média', 3: 'Alta' }[priority];
    const titleMarkup = source
      ? `<button type="button" class="weekly-item-title weekly-task-open" data-open-weekly="${escapeHtml(item.id)}" aria-label="Abrir tarefa ${escapeHtml(title)}">${escapeHtml(title)}</button>`
      : `<span class="weekly-item-title">${escapeHtml(title)}</span>`;
    return `<tr class="${item.done ? 'is-done' : ''}">
      <td><input type="checkbox" data-weekly-id="${escapeHtml(item.id)}" ${item.done ? 'checked' : ''} ${disabled ? 'disabled' : ''}
        aria-label="Concluir ${escapeHtml(title)}"></td>
      <td><div class="weekly-item-copy">${titleMarkup}<small class="weekly-item-meta">
          <span class="weekly-category" title="Categoria: ${escapeHtml(category)}"><i class="fas fa-folder" aria-hidden="true"></i> ${escapeHtml(category)}</span>
          ${priorityLabel ? `<span class="weekly-priority weekly-priority-${priority}" aria-label="Prioridade: ${priorityLabel}">${priorityLabel}</span>` : ''}
          <span class="weekly-origin-icon" data-weekly-origin="${item.activityId ? 'bank' : 'manual'}" role="img" aria-label="${origin}" title="${origin}"><i class="fas ${item.activityId ? 'fa-database' : 'fa-pen'}" aria-hidden="true"></i></span>
          ${item.activityId && !source ? '<span>Tarefa removida do banco</span>' : ''}
        </small></div></td>
      <td><button type="button" class="btn-icon" data-remove-weekly="${escapeHtml(item.id)}" ${disabled ? 'disabled' : ''}
        aria-label="Remover ${escapeHtml(title)} da semana" title="Remover da semana">×</button></td></tr>`;
  }).join('') : '<tr><td colspan="3" class="weekly-empty">Sua semana está livre. Adicione o primeiro item para começar.</td></tr>';
  if (focusId) {
    [...rows.querySelectorAll(focusSelector)].find(element =>
      (element.dataset.weeklyId || element.dataset.removeWeekly || element.dataset.openWeekly) === focusId)?.focus();
  }
}

// Todas as alterações leem a versão atual no servidor. Duas abas ou aparelhos
// não sobrescrevem inclusões ou uma virada de semana concorrente.
async function performMutation(action) {
  if (!userId) throw new Error('Entre na sua conta para usar a checklist.');
  const owner = userId;
  const sourceActivities = activities.map(activity => ({ ...activity }));
  const key = todayKey();
  const apply = (current, source) => {
    if (action.type === 'sync') return isExpired(current, key) ? current : reconcileTracked(current, sourceActivities);
    // Uma operação iniciada na semana anterior não pode alterar a nova semana.
    if (action.week && action.week !== current.weekStart) throw new Error('A semana mudou. Confira a lista e tente novamente.');
    if (action.type === 'rollover') return beginNewWeek(current, key);
    if (isExpired(current, key)) throw new Error('Comece uma nova semana antes de alterar a checklist.');
    if (action.type === 'track') return setTracked(current, source, action.tracked);
    if (action.type === 'add') return { ...current, items: [...current.items, {
      id: action.id, activityId: null, title: action.title, done: false
    }] };
    const item = current.items.find(entry => entry.id === action.id);
    if (!item) throw new Error('Esse item já foi removido da checklist.');
    if (action.type === 'complete-task') {
      if (!item.done || item.activityId !== action.activityId) throw new Error('Confira o item antes de concluir a tarefa.');
      return current;
    }
    if (action.type === 'remove') {
      if (item.activityId) return setTracked(current, { id: item.activityId }, false);
      return { ...current, items: current.items.filter(entry => entry.id !== action.id) };
    }
    return { ...current, items: current.items.map(entry => entry.id === action.id ? { ...entry, done: action.done } : entry) };
  };
  const activityPatch = (current, next) => {
    if (action.type === 'track') return [{ id: action.activityId, data: { isTracked: action.tracked } }];
    if (action.type === 'remove') {
      const item = current.items.find(entry => entry.id === action.id);
      return item?.activityId && sourceActivities.some(activity => activity.id === item.activityId)
        ? [{ id: item.activityId, data: { isTracked: false } }] : [];
    }
    if (action.type === 'rollover' && next !== current) {
      // As regras de activities não permitem ler documentos inexistentes.
      // Uma tarefa já removida do banco não deve impedir a renovação da semana.
      return current.items.filter(item => item.done && item.activityId
        && sourceActivities.some(activity => activity.id === item.activityId))
        .map(item => ({ id: item.activityId, data: { isTracked: false } }));
    }
    if (action.type === 'complete-task') return [{ id: action.activityId, complete: true }];
    return [];
  };
  const completion = activity => ({
    status: 'completed', completionDate: key,
    ...(activity.useChecklist && Array.isArray(activity.checklist)
      ? { checklist: activity.checklist.map(item => ({ ...item, done: true })) } : {})
  });

  if (demo()) {
    const current = state || emptyWeek(owner, key);
    const source = activities.find(activity => activity.id === action.activityId);
    if (action.type === 'track' && !source) throw new Error('Tarefa não encontrada no banco.');
    const next = apply(current, source);
    // Salva antes de mudar a interface. Se o navegador recusar, o item fica no formulário.
    localStorage.setItem(DEMO_KEY, JSON.stringify(next));
    state = next;
    for (const patch of activityPatch(current, next)) {
      const activity = activities.find(entry => entry.id === patch.id);
      if (activity) await window.RotinaDemoCore?.updateActivity?.(patch.id, patch.complete ? completion(activity) : patch.data);
    }
    render();
    return;
  }
  if (!navigator.onLine) throw new Error('Conecte-se para salvar alterações na checklist.');
  const reference = doc(db, 'weekly_checklists', owner);
  const result = await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists() ? snapshot.data() : emptyWeek(owner, key);
    const sourceRef = action.activityId ? doc(db, 'activities', action.activityId) : null;
    const sourceSnapshot = sourceRef ? await transaction.get(sourceRef) : null;
    const source = sourceSnapshot?.exists() ? { ...sourceSnapshot.data(), id: sourceSnapshot.id } : null;
    if (action.type === 'track' && !source) throw new Error('Tarefa não encontrada no banco.');
    if (action.type === 'complete-task' && !source) throw new Error('A tarefa foi removida do banco. O check semanal foi mantido.');
    const next = apply(current, source);
    const patches = activityPatch(current, next);
    // Todas as leituras vêm antes das escritas, inclusive para tarefas excluídas.
    const patchSnapshots = await Promise.all(patches.map(patch => transaction.get(doc(db, 'activities', patch.id))));
    if (!snapshot.exists() || JSON.stringify(current) !== JSON.stringify(next)) transaction.set(reference, next);
    patches.forEach((patch, index) => {
      const activitySnapshot = patchSnapshots[index];
      if (activitySnapshot.exists()) transaction.update(activitySnapshot.ref,
        patch.complete ? completion(activitySnapshot.data()) : patch.data);
    });
    return next;
  });
  if (userId === owner) { state = result; render(); }
}

function mutate(action) {
  const owner = userId;
  const operation = mutationQueue.catch(() => {}).then(async () => {
    if (owner !== userId) throw new Error('A conta mudou. Reabra a checklist.');
    if (action.type !== 'sync') { busy = true; errorMessage = ''; render(); }
    try { await performMutation(action); }
    finally { busy = false; render(); }
  });
  mutationQueue = operation;
  return operation;
}

async function syncTracked() {
  if (!userId || !activitiesReady || syncing || (!demo() && !navigator.onLine)) return;
  syncing = true;
  const version = activitiesVersion;
  try { await mutate({ type: 'sync' }); errorMessage = ''; }
  catch (error) { reportError(error); }
  finally {
    syncing = false;
    if (version !== activitiesVersion) syncTracked();
  }
}

function startDemo(nextActivities) {
  if (userId !== 'demo-user') {
    unsubscribeWeek?.(); unsubscribeActivities?.();
    unsubscribeWeek = unsubscribeActivities = null;
    userId = 'demo-user';
    try { state = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); }
    catch (_) { state = null; }
    if (!state || !Array.isArray(state.items) || !state.weekStart) state = emptyWeek(userId);
  }
  activities = nextActivities;
  activitiesReady = true;
  activitiesVersion++;
  render();
  syncTracked();
}

createScreen();
window.RotinaWeeklyChecklist = {
  setTrackedActivity: (activity, tracked) => mutate({ type: 'track', activityId: activity.id, tracked, week: state?.weekStart }),
  cancelConfirmation: () => {
    const dialog = document.getElementById('weekly-confirm');
    if (!dialog.open) return false;
    dialog.close('no');
    return true;
  },
  showError: error => {
    reportError(error);
    let notice = document.getElementById('weekly-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'weekly-notice';
      notice.className = 'weekly-notice';
      notice.setAttribute('role', 'alert');
      document.body.appendChild(notice);
    }
    notice.textContent = errorMessage;
    notice.classList.remove('hidden');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.classList.add('hidden'), 6000);
  }
};

document.addEventListener('rotinaos:demo-activities', event => {
  if (demo()) startDemo(event.detail?.activities || []);
});
onAuthStateChanged(auth, user => {
  if (demo()) { startDemo(window.__ROTINAOS_DEMO_ACTIVITIES__ || []); return; }
  unsubscribeWeek?.(); unsubscribeActivities?.();
  userId = user?.uid || null;
  state = null; activities = []; activitiesReady = false; errorMessage = '';
  window.RotinaWeeklyChecklist.cancelConfirmation();
  document.getElementById('weekly-checklist-view').classList.add('hidden');
  render();
  if (!user) return;
  const owner = user.uid;
  unsubscribeWeek = onSnapshot(doc(db, 'weekly_checklists', owner), snapshot => {
    if (owner !== userId) return;
    state = snapshot.exists() ? snapshot.data() : null;
    render(); syncTracked();
  }, reportError);
  unsubscribeActivities = onSnapshot(query(collection(db, 'activities'), where('userId', '==', owner)), snapshot => {
    if (owner !== userId) return;
    activities = snapshot.docs.map(item => ({ ...item.data(), id: item.id }));
    activitiesReady = true; activitiesVersion++;
    render(); syncTracked();
  }, reportError);
});
window.addEventListener('online', () => { render(); syncTracked(); });
window.addEventListener('offline', render);
window.addEventListener('focus', render);
// A lista também encerra enquanto o app permanece aberto na virada da semana.
setInterval(render, 30_000);
if (demo()) startDemo(window.__ROTINAOS_DEMO_ACTIVITIES__ || []);
