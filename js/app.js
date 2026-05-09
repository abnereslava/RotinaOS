import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, updateDoc, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC-iFjByyV-QLGP253kdlJYVqvryw1BI2E",
  authDomain: "planejamentosemanal-6d1dc.firebaseapp.com",
  projectId: "planejamentosemanal-6d1dc",
  storageBucket: "planejamentosemanal-6d1dc.firebasestorage.app",
  messagingSenderId: "537704966796",
  appId: "1:537704966796:web:74b8c137790698f7f8a9a9"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Estado do App
let currentUser = null;
let activities = [];
let pendingActivityToSchedule = null;
let currentSelectedBlock = null;
let currentTab = 'pending';
let editingActivityId = null;
let isChecklistMode = false;
let isCompactMode = localStorage.getItem('isCompactMode') === 'true';

// Filtros Persistidos
let sidebarFilterCategory = localStorage.getItem('sidebarFilterCategory') || '';
let sidebarSortMode = localStorage.getItem('sidebarSortMode') || 'none';
let fullViewSortMode = localStorage.getItem('fullViewSortMode') || 'none';
let fullViewHideScheduled = localStorage.getItem('fullViewHideScheduled') === 'true';

// Modo Demonstração
let isDemoMode = false;
const mockActivities = [
    { id: 'demo1', title: '🚀 Explorar o To-doOS', category: 'Tutorial', priority: '3', recurrence: 'single', status: 'pending', createdAt: Date.now() },
    { id: 'demo2', title: '🍔 Almoçar com a equipe', category: 'Social', priority: '2', recurrence: 'daily', scheduledTime: '12:00', status: 'pending', createdAt: Date.now() },
    { id: 'demo3', title: '💻 Finalizar Projeto X', category: 'Trabalho', priority: '3', recurrence: 'single', deadline: '2026-05-15', status: 'pending', createdAt: Date.now() },
    { id: 'demo4', title: '🎸 Praticar Violão', category: 'Hobby', priority: '1', recurrence: 'weekly', fixedDays: [1, 3, 5], status: 'pending', createdAt: Date.now() },
    { id: 'demo5', title: '🧹 Limpar a sala', category: 'Casa', priority: '1', recurrence: 'weekly', fixedDays: [6], status: 'completed', createdAt: Date.now() },
    { id: 'demo6', title: '📚 Ler 20 páginas', category: 'Estudos', priority: '2', recurrence: 'single', status: 'pending', createdAt: Date.now() },
    { id: 'demo7', title: '🛒 Fazer compras', category: 'Casa', priority: '1', recurrence: 'single', status: 'pending', createdAt: Date.now() },
    { id: 'demo8', title: '🎧 Podcast Semanal', category: 'Hobby', priority: '2', recurrence: 'weekly', fixedDays: [2, 4], status: 'pending', createdAt: Date.now() },
    { id: 'demo9', title: '☕ Café da manhã', category: 'Rotina', priority: '1', recurrence: 'daily', scheduledTime: '08:30', status: 'pending', createdAt: Date.now() },
    { id: 'demo10', title: '📞 Reunião de Alinhamento', category: 'Trabalho', priority: '3', recurrence: 'single', scheduledTime: '10:00', status: 'pending', createdAt: Date.now() },
    { id: 'demo11', title: '🏋️ Treino na Academia', category: 'Saúde', priority: '2', recurrence: 'daily', scheduledTime: '18:00', status: 'pending', createdAt: Date.now() }
];

// Auxiliar de Mutação (Intercepta para o Modo Demo)
async function safeUpdate(id, data) {
    if (isDemoMode) {
        const idx = activities.findIndex(a => a.id === id);
        if (idx !== -1) activities[idx] = { ...activities[idx], ...data };
        renderAgenda();
        renderPendingList();
        populateCategories();
        return;
    }
    await updateDoc(doc(db, "activities", id), data);
}

async function safeDelete(id) {
    if (isDemoMode) {
        activities = activities.filter(a => a.id !== id);
        renderAgenda();
        renderPendingList();
        return;
    }
    await deleteDoc(doc(db, "activities", id));
}

async function safeAdd(data) {
    if (isDemoMode) {
        const newId = 'demo-' + Date.now();
        activities.push({ id: newId, ...data });
        renderAgenda();
        renderPendingList();
        populateCategories();
        return;
    }
    await addDoc(collection(db, "activities"), data);
}

// Registro do Service Worker para PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(reg => {
      console.log('SW registered!');
      
      // Se houver uma atualização esperando, avisa ou tenta atualizar
      reg.onupdatefound = () => {
        const newWorker = reg.installing;
        newWorker.onstatechange = () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('Nova versão disponível! O SW será atualizado.');
          }
        };
      };
    })
    .catch(err => console.error('Error registering SW', err));

  // Recarrega a página quando um novo Service Worker assume o controle
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      window.location.reload();
      refreshing = true;
    }
  });
}

// Elementos de Interface
const appEl = document.getElementById('app');
const authContainer = document.getElementById('auth-container');
const toggleSidebarBtn = document.getElementById('toggle-sidebar');
const sidebar = document.getElementById('sidebar');
const btnNewActivity = document.getElementById('btn-new-activity');
const modalActivity = document.getElementById('modal-activity');
const modalSchedule = document.getElementById('modal-schedule');
const modalCompletion = document.getElementById('modal-completion');
const formActivity = document.getElementById('form-activity');
const pendingList = document.getElementById('pending-activities-list');
const agendaGrid = document.getElementById('agenda-grid');
const timeLabelsGrid = document.getElementById('time-grid-labels');

// ============================================================================
// LÓGICA DE AUTENTICAÇÃO
// ============================================================================
const formAuth = document.getElementById('form-auth');

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    authContainer.classList.add('hidden');
    appEl.classList.remove('hidden');
    loadActivities();
    setTimeout(scrollToCurrentTimeIndicator, 800); // Aguarda renderizar
  } else {
    currentUser = null;
    authContainer.classList.remove('hidden');
    appEl.classList.add('hidden');
  }
});

formAuth.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    showAlert('Erro de Autenticação: Verifique suas credenciais.', 'Erro de Login');
  }
});

// Listener Modo Demo
document.getElementById('btn-demo-mode')?.addEventListener('click', () => {
    isDemoMode = true;
    currentUser = { uid: 'demo-user', email: 'demo@todoos.app' };
    
    // Sincroniza atividades agendadas com a data de hoje
    const today = getTodayString();
    activities = mockActivities.map(a => {
        if (a.scheduledTime && !a.fixedDays) {
            return { ...a, scheduledDate: today };
        }
        return a;
    });
    authContainer.classList.add('hidden');
    appEl.classList.remove('hidden');
    
    renderPendingList();
    renderAgenda();
    populateCategories(); // Adicionado para preencher o filtro de categorias no modo demo
    
    document.getElementById('modal-demo-notice').classList.remove('hidden');
});

document.getElementById('btn-close-demo-notice')?.addEventListener('click', () => {
    document.getElementById('modal-demo-notice').classList.add('hidden');
});

document.getElementById('btn-logout').addEventListener('click', async () => {
    const ok = await showConfirm('Deseja realmente sair da conta?', 'Sair');
    if (!ok) return;
    
    if (isDemoMode) {
        window.location.reload();
        return;
    }
    signOut(auth);
});

// ============================================================================
// MODAIS DE SISTEMA (substitui alert/confirm nativos)
// ============================================================================
function showAlert(msg, title = 'Aviso') {
  return new Promise(resolve => {
    document.getElementById('modal-alert-title').innerHTML =
      `<i class="fas fa-exclamation-triangle"></i> ${title}`;
    document.getElementById('modal-alert-msg').textContent = msg;
    const modal = document.getElementById('modal-alert');
    modal.classList.remove('hidden');
    const btn = document.getElementById('modal-alert-ok');
    const handler = () => { modal.classList.add('hidden'); btn.removeEventListener('click', handler); resolve(); };
    btn.addEventListener('click', handler);
  });
}

function showConfirm(msg, title = 'Confirmar') {
  return new Promise(resolve => {
    document.getElementById('modal-confirm-title').innerHTML =
      `<i class="fas fa-question-circle"></i> ${title}`;
    document.getElementById('modal-confirm-msg').textContent = msg;
    const modal = document.getElementById('modal-confirm');
    modal.classList.remove('hidden');
    const okBtn = document.getElementById('modal-confirm-ok');
    const cancelBtn = document.getElementById('modal-confirm-cancel');
    const cleanup = () => {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    };
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ============================================================================
// SIDEBAR & FECHAMENTO DE MODAIS
// ============================================================================
toggleSidebarBtn.addEventListener('click', () => {
  sidebar.classList.remove('hidden');
  appEl.classList.add('sidebar-open');
});

document.getElementById('close-sidebar').addEventListener('click', () => {
  sidebar.classList.add('hidden');
  appEl.classList.remove('sidebar-open');
});

document.querySelectorAll('.close-modal').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.target.closest('.modal').classList.add('hidden');
    pendingActivityToSchedule = null;
    currentSelectedBlock = null;
  });
});

// ============================================================================
// LÓGICA DE DATAS E FUSO HORÁRIO (Forçando GMT-3: America/Sao_Paulo)
// ============================================================================
function getTodayString() {
  const options = { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('pt-BR', options).formatToParts(new Date());
  const d = parts.find(p => p.type === 'day').value;
  const m = parts.find(p => p.type === 'month').value;
  const y = parts.find(p => p.type === 'year').value;
  return `${y}-${m}-${d}`;
}
let todayString = getTodayString();

const dateTitle = document.getElementById('current-date-title');
const now = new Date();
const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(now);
const restOfDate = new Intl.DateTimeFormat('pt-BR', { 
  timeZone: 'America/Sao_Paulo', 
  day: '2-digit', 
  month: 'long', 
  year: 'numeric' 
}).format(now);

dateTitle.innerHTML = `${weekday},<br>${restOfDate}`;

// ============================================================================
// CONSTRUÇÃO DO GRID DE HORÁRIOS
// ============================================================================
function generateGrid() {
  timeLabelsGrid.innerHTML = '';
  for (let i = 0; i < 24; i++) {
    const label = document.createElement('div');
    label.className = 'time-label';
    label.innerHTML = `<span>${String(i).padStart(2, '0')}:00</span>`;
    timeLabelsGrid.appendChild(label);
  }
}
generateGrid();

function updateTimeIndicator() {
  const indicator = document.getElementById('current-time-indicator');
  if (!indicator) return;

  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    minute: 'numeric'
  }).formatToParts(new Date());

  let hour = 0, minute = 0;
  parts.forEach(p => {
    if (p.type === 'hour') hour = parseInt(p.value);
    if (p.type === 'minute') minute = parseInt(p.value);
  });

  indicator.style.top = `${(hour * 60 + minute) * 2}px`;

  if (isCompactMode) {
    indicator.style.display = 'none';
  } else {
    indicator.style.display = 'block';
  }
}
setInterval(updateTimeIndicator, 60000);
updateTimeIndicator();

function scrollToCurrentTimeIndicator() {
  const agendaContainer = document.getElementById('agenda-container');
  const indicator = document.getElementById('current-time-indicator');
  if (agendaContainer && indicator) {
    const topPosition = parseInt(indicator.style.top) || 0;
    // 30% da altura visível
    const offset = agendaContainer.clientHeight * 0.3;
    agendaContainer.scrollTo({
      top: Math.max(0, topPosition - offset),
      behavior: 'smooth'
    });
  }
}

// ============================================================================
// FIREBASE: CARREGAMENTO E MANIPULAÇÃO DE DADOS
// ============================================================================
function loadActivities() {
  if (isDemoMode) return;
  if (!currentUser) return;
  const q = query(collection(db, "activities"), where("userId", "==", currentUser.uid));

  onSnapshot(q, async (snapshot) => {
    todayString = getTodayString(); // Atualiza a data a cada snapshot para evitar stale date
    let loadedActivities = [];
    snapshot.forEach((doc) => {
      loadedActivities.push({ id: doc.id, ...doc.data() });
    });

    // Roda a rotina de manutenção (vai causar novos snapshots se atualizar algo, mas ok)
    await runDailyMaintenance(loadedActivities);

    // Usa a lista (possivelmente antes das atualizações refletirem, mas na próxima batida do snapshot atualiza)
    activities = loadedActivities;
    populateCategories();
    renderAgenda();
    renderPendingList();
  });
}

async function runDailyMaintenance(loadedActivities) {
  const [ty, tm, td] = todayString.split('-').map(Number);
  const todayDate = new Date(ty, tm - 1, td);
  const promises = [];

  for (const a of loadedActivities) {
    if (a.recurrence === 'single') {
      // Deletar se concluída no passado
      if (a.status === 'completed' && a.completionDate && a.completionDate < todayString) {
        promises.push(safeDelete(a.id));
        continue;
      }
      // Se não concluída e ficou no passado, rolar para hoje (se tem horário, continua na agenda)
      if (a.status !== 'completed' && a.scheduledDate && a.scheduledDate < todayString) {
        promises.push(safeUpdate(a.id, { scheduledDate: todayString }));
        continue;
      }
    } else {
      // Recorrentes: resetar conclusão se o ciclo virou
      if (a.status !== 'pending' && a.completionDate) {
        const [cy, cm, cd] = a.completionDate.split('-').map(Number);
        const compDate = new Date(cy, cm - 1, cd);
        let shouldReset = false;

        if (a.recurrence === 'daily') {
          if (a.completionDate < todayString) shouldReset = true;
        } else if (a.recurrence === 'weekly') {
          // Virada de sábado pra domingo
          const compWeekStart = new Date(compDate);
          compWeekStart.setDate(compDate.getDate() - compDate.getDay());
          const todayWeekStart = new Date(todayDate);
          todayWeekStart.setDate(todayDate.getDate() - todayDate.getDay());
          if (todayWeekStart > compWeekStart) shouldReset = true;
        } else if (a.recurrence === 'monthly') {
          if (todayDate.getFullYear() > compDate.getFullYear() || todayDate.getMonth() > compDate.getMonth()) {
            shouldReset = true;
          }
        }

        if (shouldReset) {
          const resetData = { status: 'pending', completionDate: null };
          if (a.useChecklist && a.checklist) {
            resetData.checklist = a.checklist.map(item => ({ ...item, done: false }));
          }
          promises.push(safeUpdate(a.id, resetData));
        }
      }
    }
  }
  if (promises.length > 0) await Promise.all(promises);
}

function populateCategories() {
  const categories = [...new Set(
    activities.map(a => a.category).filter(c => c && c.trim() !== '')
  )].sort();

  const datalist = document.getElementById('category-list');
  datalist.innerHTML = '';
  categories.forEach(cat => {
    datalist.innerHTML += `<option value="${cat}">`;
  });

  const filterSelect = document.getElementById('filter-category');
  const prevValue = filterSelect.value;
  filterSelect.innerHTML = '<option value="">Todas as categorias</option>';
  categories.forEach(cat => {
    filterSelect.innerHTML += `<option value="${cat}">${cat}</option>`;
  });

  if (categories.includes(prevValue)) {
    filterSelect.value = prevValue;
  }
}

function isActivityActiveToday(a) {
  const [y, m, d] = todayString.split('-');
  const currentDayDate = new Date(y, m - 1, d);

  // 1. NÃO SUMIR DE IMEDIATO: Se foi concluída em um dia anterior, não exibe na agenda de hoje.
  // Se foi concluída HOJE, ela passa por essa verificação e continua sendo exibida.
  if (a.status === 'completed' && a.completionDate && a.completionDate !== todayString) return false;

  // Atividade agendada especificamente para hoje
  if (a.scheduledDate === todayString && a.scheduledTime) {
    return true;
  }

  // Única + parcial: reaparece até ser totalmente concluída
  if (a.recurrence === 'single' && a.status === 'partial' && a.scheduledTime) return true;

  if (a.recurrence === 'daily' && a.scheduledTime) {
    return true;
  }

  // MÚLTIPLOS DIAS FIXOS (Semanal)
  if (a.recurrence === 'weekly' && a.fixedDays && a.fixedDays.length > 0 && a.scheduledTime) {
    const currentDay = currentDayDate.getDay();
    if (a.fixedDays.some(d => d === currentDay)) return true; 
  }

  // DIAS DO MÊS (Mensal)
  if (a.recurrence === 'monthly' && a.monthlyDays && a.scheduledTime) {
    const dayOfMonth = currentDayDate.getDate();
    const daysArr = a.monthlyDays.split(',').map(d => parseInt(d.trim()));
    if (daysArr.some(d => d === dayOfMonth)) return true; 
  }
  return false;
}

// ============================================================================
// RENDERIZAÇÃO DA AGENDA DO DIA
// ============================================================================
document.getElementById('btn-toggle-view')?.addEventListener('click', () => {
  isCompactMode = !isCompactMode;
  localStorage.setItem('isCompactMode', isCompactMode);
  applyViewMode();
});

function applyViewMode() {
  const btn = document.getElementById('btn-toggle-view');
  const container = document.getElementById('agenda-container');
  if (!btn || !container) return;
  
  if (isCompactMode) {
    container.classList.add('compact-mode');
    btn.style.color = 'var(--accent-color)';
  } else {
    container.classList.remove('compact-mode');
    btn.style.color = '';
  }
  renderAgenda();
}

// Inicializa o modo de visualização no carregamento
setTimeout(applyViewMode, 100);

function renderAgenda() {
  document.querySelectorAll('.activity-block, .activity-group-wrapper, .compact-time-indicator').forEach(b => b.remove());

  const todaysActivities = activities.filter(a => isActivityActiveToday(a));
  const groups = buildOverlapGroups(todaysActivities);

  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date());
  let hour = 0, minute = 0;
  parts.forEach(p => { if (p.type === 'hour') hour = parseInt(p.value); if (p.type === 'minute') minute = parseInt(p.value); });
  const nowMinutes = hour * 60 + minute;
  let indicatorPlaced = false;

  groups.forEach(group => {
    const cols = group.length;
    let groupContainer = document.getElementById('agenda-grid');
    let minStart = 0;
    let maxEnd = 0;

    if (isCompactMode) {
      minStart = Math.min(...group.map(a => { const [h, m] = a.scheduledTime.split(':').map(Number); return h * 60 + m; }));
      maxEnd = Math.max(...group.map(a => { const [h, m] = a.scheduledTime.split(':').map(Number); return (h * 60 + m) + (a.duration || 60); }));

      // Indicador antes do grupo se necessário
      if (!indicatorPlaced && nowMinutes < minStart) {
        const ind = document.createElement('div');
        ind.className = 'compact-time-indicator';
        ind.style.display = 'flex'; ind.style.alignItems = 'center'; ind.style.gap = '10px'; ind.style.color = 'var(--accent-color)'; ind.style.fontSize = '0.8rem';
        ind.innerHTML = `<i class="fas fa-clock"></i> <div style="flex:1; height: 2px; background: var(--accent-color); box-shadow: 0 0 8px rgba(217,123,58,0.5);"></div>`;
        document.getElementById('agenda-grid').appendChild(ind);
        indicatorPlaced = true;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'activity-group-wrapper';

      const groupTimeLabel = document.createElement('div');
      groupTimeLabel.style.fontSize = '0.75rem';
      groupTimeLabel.style.color = 'var(--text-secondary)';
      groupTimeLabel.style.marginBottom = '5px';
      groupTimeLabel.style.fontFamily = "'Chakra Petch', monospace";
      groupTimeLabel.textContent = `${String(Math.floor(minStart / 60)).padStart(2, '0')}:${String(minStart % 60).padStart(2, '0')} - ${String(Math.floor(maxEnd / 60)).padStart(2, '0')}:${String(maxEnd % 60).padStart(2, '0')}`;

      groupContainer = document.createElement('div');
      groupContainer.className = 'activity-group';
      groupContainer.style.position = 'relative';
      groupContainer.style.width = '100%';
      groupContainer.style.height = `${(maxEnd - minStart) * 2}px`;

      wrapper.appendChild(groupTimeLabel);
      wrapper.appendChild(groupContainer);
      document.getElementById('agenda-grid').appendChild(wrapper);

      // Indicador dentro do grupo se necessário
      if (!indicatorPlaced && nowMinutes >= minStart && nowMinutes <= maxEnd) {
        const ind = document.createElement('div');
        ind.className = 'compact-time-indicator';
        ind.style.position = 'absolute'; ind.style.left = '0'; ind.style.right = '0'; ind.style.height = '2px'; ind.style.backgroundColor = 'var(--accent-color)'; ind.style.zIndex = '10'; ind.style.boxShadow = '0 0 8px rgba(217,123,58,0.5)';
        ind.style.top = `${(nowMinutes - minStart) * 2}px`;
        const dot = document.createElement('div');
        dot.style.position = 'absolute'; dot.style.left = '-5px'; dot.style.top = '-4px'; dot.style.width = '10px'; dot.style.height = '10px'; dot.style.backgroundColor = 'var(--accent-color)'; dot.style.borderRadius = '50%';
        ind.appendChild(dot);
        groupContainer.appendChild(ind);
        indicatorPlaced = true;
      }
    }

    group.forEach((act, idx) => {
      const block = document.createElement('div');
      block.className = 'activity-block';

      if (act.status === 'completed' && act.completionDate === todayString) {
        block.classList.add('completed');
      } else if (act.status === 'partial' && act.completionDate === todayString) {
        block.classList.add('partial');
      }

      const prio = parseInt(act.priority) || 0;
      block.classList.add(`priority-${prio}`);

      const [hh, mm] = act.scheduledTime.split(':').map(Number);
      const topMinutes = (hh * 60 + mm) - minStart;
      const duration = act.duration || 60;

      block.style.top = `${topMinutes * 2}px`;
      block.style.height = `${duration * 2}px`;

      const widthPercent = 100 / cols;
      block.style.width = `calc(${widthPercent}% - 4px)`;
      block.style.left = `${idx * widthPercent}%`;

      const showWarning = act.recurrence === 'weekly' && !wasCompletedThisWeek(act);

      // INDICADORES DOS CARDS: Frequência, Categoria, Prioridade e Horário Fixo[cite: 2]
      const recurLabels = { single: 'Única', daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal' };
      const prioIcons = { 0: '—', 1: '↓ Baixa', 2: '→ Média', 3: '↑ Alta' };
      const recurText = recurLabels[act.recurrence] || '—';
      const catText = act.category || 'Geral';
      const prioText = prioIcons[prio];
      // Exibe a tachinha caso o horário exista na base
      const isFixedTime = act.scheduledTime ? '<i class="fas fa-thumbtack" title="Horário Fixado" style="color: var(--accent-color); margin-right: 5px;"></i>' : '';

      block.innerHTML = `
                <div class="block-title" title="${act.title}">${isFixedTime}${act.title}</div>
                <div class="block-time">${act.scheduledTime} (${duration}m)</div>
                <div class="block-meta" style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 5px; font-family: 'Chakra Petch', monospace; font-size: 0.65rem; color: var(--text-primary);">
                    <span style="background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 2px;">${recurText}</span>
                    <span style="background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 2px;">${catText}</span>
                    ${prio > 0 ? `<span style="background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 2px;">Prio ${prioText}</span>` : ''}
                </div>
                <button class="toggle-btn"></button>
                ${showWarning ? '<div class="warning-icon" title="Atividade semanal pendente">!</div>' : ''}
            `;

      block.addEventListener('click', () => {
        showDetailModal(act);
      });

      block.querySelector('.toggle-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (act.status === 'completed' && act.completionDate === todayString) {
          let updateData = { status: 'pending', completionDate: null };
          if (act.useChecklist && act.checklist) {
            act.checklist.forEach(i => i.done = false);
            updateData.checklist = act.checklist;
          }
          await safeUpdate(act.id, updateData);
        } else {
          if (act.recurrence === 'single') {
            currentSelectedBlock = act;
            modalCompletion.classList.remove('hidden');

            const resetBtn = document.getElementById('btn-complete-reset');
            if (resetBtn) {
              if (act.status === 'partial') {
                resetBtn.style.display = 'block';
              } else {
                resetBtn.style.display = 'none';
              }
            }
          } else {
            let updateData = { status: 'completed', completionDate: todayString };
            if (act.useChecklist && act.checklist) {
              act.checklist.forEach(i => i.done = true);
              updateData.checklist = act.checklist;
            }
            await safeUpdate(act.id, updateData);
          }
        }
      });

      groupContainer.appendChild(block);
    });
  });

  if (isCompactMode && !indicatorPlaced) {
    const ind = document.createElement('div');
    ind.className = 'compact-time-indicator';
    ind.style.display = 'flex'; ind.style.alignItems = 'center'; ind.style.gap = '10px'; ind.style.color = 'var(--accent-color)'; ind.style.fontSize = '0.8rem';
    ind.innerHTML = `<i class="fas fa-clock"></i> <div style="flex:1; height: 2px; background: var(--accent-color); box-shadow: 0 0 8px rgba(217,123,58,0.5);"></div>`;
    document.getElementById('agenda-grid').appendChild(ind);
  }

  updateTimeIndicator();
}

function buildOverlapGroups(activitiesList) {
  const sorted = activitiesList.sort((a, b) => {
    const [h1, m1] = a.scheduledTime.split(':').map(Number);
    const [h2, m2] = b.scheduledTime.split(':').map(Number);
    return (h1 * 60 + m1) - (h2 * 60 + m2);
  });

  const groups = [];
  let currentGroup = [];
  let groupEnd = 0;

  sorted.forEach(act => {
    const [h, m] = act.scheduledTime.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (act.duration || 60);

    if (currentGroup.length === 0) {
      currentGroup.push(act);
      groupEnd = end;
    } else {
      if (start < groupEnd) {
        currentGroup.push(act);
        groupEnd = Math.max(groupEnd, end);
      } else {
        groups.push([...currentGroup]);
        currentGroup = [act];
        groupEnd = end;
      }
    }
  });
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  return groups;
}

// ============================================================================
// CÁLCULOS E HELPER FUNCTIONS
// ============================================================================
function showDetailModal(act, isPendingMode = false) {
  const existing = document.getElementById('modal-detail-overlay');
  if (existing) existing.remove();

  const prioLabels = { 0: '— Não definida', 1: '↓ Baixa', 2: '→ Média', 3: '↑ Alta' };
  const recurLabels = { single: 'Única', daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal' };
  const statusLabels = { pending: 'Pendente', completed: 'Concluída', partial: 'Parcial' };

  const prio = parseInt(act.priority) || 0;
  const prioText = prioLabels[prio] ?? '—';
  const recurText = recurLabels[act.recurrence] ?? act.recurrence ?? '—';
  const statusText = statusLabels[act.status] ?? act.status ?? '—';
  const deadlineText = act.deadline ? act.deadline : '—';
  const detailText = act.details && act.details.trim() !== '' ? act.details : '';

  let checklistHtml = '';
  if (act.useChecklist && act.checklist && act.checklist.length > 0) {
    const itemsHtml = act.checklist.map((item, index) => `
            <label class="detail-checklist-item ${item.done ? 'done' : ''}">
                <input type="checkbox" data-index="${index}" ${item.done ? 'checked' : ''}>
                <span>${item.text.replace(/</g, '&lt;')}</span>
            </label>
        `).join('');
    checklistHtml = `<div class="meta-divider"></div><div class="detail-checklist" id="detail-checklist-container">${itemsHtml}</div>`;
  }

  let linksHtml = '';
  if (act.links && act.links.length > 0) {
    const linkBtns = act.links.map((url, i) => `
            <a href="${url}" target="_blank" class="detail-link-btn" title="${url}">
                <i class="fas fa-link"></i> Link ${i + 1}
            </a>
        `).join('');
    linksHtml = `<div class="meta-divider"></div><div class="detail-links-row">${linkBtns}</div>`;
  }

  // Determina o status atual para montar os botões dinamicamente
  const isCompleted = act.status === 'completed' && act.completionDate === todayString;
  const isPartial = act.status === 'partial' && act.completionDate === todayString;
  const isScheduledToday = isActivityActiveToday(act);

  // Botões de ação: varia conforme recorrência e status atual
  let actionButtons = '';
  let schedulingHtml = '';

  if (isPendingMode) {
    actionButtons = `
            <button type="button" class="btn-primary" id="detail-btn-schedule">
                <i class="fas fa-clock"></i> ${isScheduledToday ? 'SALVAR HORÁRIO' : 'AGENDAR'}
            </button>`;

    let startVal = '';
    let endVal = '';
    if (isScheduledToday) {
      startVal = act.scheduledTime;
      if (act.duration) {
        const [h, m] = startVal.split(':').map(Number);
        const totalMins = h * 60 + m + act.duration;
        const endH = Math.floor(totalMins / 60) % 24;
        const endM = totalMins % 60;
        endVal = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
      }
    }

    schedulingHtml = `
            <div class="meta-divider"></div>
            <div class="modal-schedule-section" style="margin-top: 15px;">
                <label style="color: var(--primary-color); font-size: 0.9rem; font-weight: 600; text-transform: uppercase; margin-bottom: 10px; display: block;"><i class="fas fa-clock"></i> ${isScheduledToday ? 'Modificar Horário Agendado' : 'Agendar para Hoje'}</label>
                <div class="form-group row" style="margin-bottom: 0;">
                    <div class="col">
                        <label style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 4px;">Início</label>
                        <input type="time" id="detail-sched-start" value="${startVal}" style="padding: 8px; font-size: 0.95rem; border: 2px solid var(--border-color); background: var(--bg-color); color: var(--text-primary); width: 100%; font-family: 'Rajdhani', sans-serif;" required>
                    </div>
                    <div class="col">
                        <label style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 4px;">Término</label>
                        <input type="time" id="detail-sched-end" value="${endVal}" style="padding: 8px; font-size: 0.95rem; border: 2px solid var(--border-color); background: var(--bg-color); color: var(--text-primary); width: 100%; font-family: 'Rajdhani', sans-serif;" required>
                    </div>
                </div>
            </div>
        `;
  } else {
    if (isCompleted || isPartial) {
      // Já marcada: mostra opção de desmarcar
      actionButtons = `
                <button type="button" class="btn-secondary" id="detail-btn-unmark">
                    <i class="fas fa-undo"></i> DESMARCAR
                </button>`;
    } else if (act.recurrence === 'single') {
      // Conclusão única: mostra os dois botões
      actionButtons = `
                <button type="button" class="btn-detail-action btn-action-partial" id="detail-btn-partial">
                    <i class="fas fa-adjust"></i> FIZ O QUE DEU
                </button>
                <button type="button" class="btn-detail-action btn-action-full" id="detail-btn-full">
                    <i class="fas fa-check"></i> CONCLUÍDA
                </button>`;
    } else {
      // Recorrente: marca como concluída direto
      actionButtons = `
                <button type="button" class="btn-detail-action btn-action-full" id="detail-btn-full">
                    <i class="fas fa-check"></i> MARCAR CONCLUÍDA
                </button>`;
    }
  }

  const overlay = document.createElement('div');
  overlay.id = 'modal-detail-overlay';
  overlay.className = 'modal';
  overlay.innerHTML = `
        <div class="modal-content modal-small">
            <div class="modal-header-slant">
                <h2><i class="fas fa-info-circle"></i> ${act.title}</h2>
            </div>
            <div class="modal-detail-meta">
                <div class="meta-row"><span class="meta-label">Categoria</span><span class="meta-value">${act.category || '—'}</span></div>
                <div class="meta-row"><span class="meta-label">Recorrência</span><span class="meta-value">${recurText}</span></div>
                <div class="meta-row"><span class="meta-label">Prioridade</span><span class="meta-value priority-badge prio-${prio}">${prioText}</span></div>
                <div class="meta-row"><span class="meta-label">Status</span><span class="meta-value">${statusText}</span></div>
                <div class="meta-row"><span class="meta-label">Data Limite</span><span class="meta-value">${deadlineText}</span></div>
                ${act.useChecklist ? checklistHtml : (detailText ? `<div class="meta-divider"></div><p class="modal-detail-body">${detailText}</p>` : '')}
                ${linksHtml}
                ${schedulingHtml}
            </div>
            <div class="detail-mgmt-divider"></div>

            <!-- Linha de gerenciamento (agora acima) -->
            <div class="modal-actions detail-mgmt-actions">
                ${isPendingMode ? '' : `
                <button type="button" class="btn-detail-mgmt btn-mgmt-return" id="detail-btn-return" title="Remove agendamento e retorna ao banco" ${act.status === 'completed' ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                    <i class="fas fa-inbox"></i> BANCO
                </button>
                `}
                <button type="button" class="btn-detail-mgmt btn-mgmt-edit" id="detail-btn-edit" title="Editar informações da atividade">
                    <i class="fas fa-edit"></i> EDITAR
                </button>
                <button type="button" class="btn-detail-mgmt btn-mgmt-delete" id="detail-btn-delete" title="Excluir permanentemente">
                    <i class="fas fa-trash"></i> DELETAR
                </button>
            </div>

            <div class="modal-actions detail-actions">
                ${actionButtons}
                <button type="button" class="btn-secondary" id="btn-close-detail">FECHAR</button>
            </div>
        </div>
    `;
  document.body.appendChild(overlay);
  overlay.classList.remove('hidden');

  // Fechar
  document.getElementById('btn-close-detail').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Listener interativo do checklist
  if (act.useChecklist && act.checklist) {
    const container = document.getElementById('detail-checklist-container');
    if (container) {
      container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', async (e) => {
          const idx = parseInt(e.target.dataset.index);
          act.checklist[idx].done = e.target.checked;
          e.target.parentElement.classList.toggle('done', e.target.checked);

          const allDone = act.checklist.every(i => i.done);
          const noneDone = act.checklist.every(i => !i.done);

          let newStatus = 'partial';
          if (allDone) newStatus = 'completed';
          if (noneDone) newStatus = 'pending';

          await safeUpdate(act.id, {
            checklist: act.checklist,
            status: newStatus,
            completionDate: newStatus !== 'pending' ? todayString : null
          });
        });
      });
    }
  }

  // Botão: concluída total
  document.getElementById('detail-btn-full')?.addEventListener('click', async () => {
    let updateData = { status: 'completed', completionDate: todayString };
    if (act.useChecklist && act.checklist) {
      act.checklist.forEach(i => i.done = true);
      updateData.checklist = act.checklist;
    }
    await safeUpdate(act.id, updateData);
    overlay.remove();
  });

  // Botão: fiz o que deu (parcial) — só para single
  document.getElementById('detail-btn-partial')?.addEventListener('click', async () => {
    let updateData = { status: 'partial', completionDate: todayString };
    await safeUpdate(act.id, updateData);
    overlay.remove();
  });

  // Botão: desmarcar
  document.getElementById('detail-btn-unmark')?.addEventListener('click', async () => {
    let updateData = { status: 'pending', completionDate: null };
    if (act.useChecklist && act.checklist) {
      act.checklist.forEach(i => i.done = false);
      updateData.checklist = act.checklist;
    }
    await safeUpdate(act.id, updateData);
    overlay.remove();
  });

  // Botão: retornar ao banco (remove agendamento, mantém atividade)
  document.getElementById('detail-btn-return')?.addEventListener('click', async () => {
    if (act.status === 'completed') return;
    await safeUpdate(act.id, {
      scheduledDate: null,
      scheduledTime: null,
      duration: null
    });
    overlay.remove();
  });

  // Botão: editar sem remover da agenda
  document.getElementById('detail-btn-edit')?.addEventListener('click', () => {
    overlay.remove();
    openEditModal(act);
  });

  // Botão: deletar permanentemente
  document.getElementById('detail-btn-delete')?.addEventListener('click', async () => {
    const ok = await showConfirm(`Deletar "${act.title}" permanentemente? Esta ação não pode ser desfeita.`, 'Deletar');
    if (ok) {
      await safeDelete(act.id);
      overlay.remove();
    }
  });

  // Botão: Agendar (modo banco)
  document.getElementById('detail-btn-schedule')?.addEventListener('click', async () => {
    const startInput = document.getElementById('detail-sched-start');
    const endInput = document.getElementById('detail-sched-end');
    if (!startInput || !endInput) return;

    const startTime = startInput.value;
    const endTime = endInput.value;

    if (!startTime || !endTime) {
      await showAlert('Por favor, preencha os horários de início e término.', 'Campos Obrigatórios');
      return;
    }

    const [hStart, mStart] = startTime.split(':').map(Number);
    const [hEnd, mEnd] = endTime.split(':').map(Number);
    const duration = (hEnd * 60 + mEnd) - (hStart * 60 + mStart);

    if (duration <= 0) {
      await showAlert('O horário de término deve ser posterior ao horário de início.', 'Horário Inválido');
      return;
    }

    const hasConflict = activities.some(a =>
      a.id !== act.id &&
      a.scheduledDate === todayString &&
      a.scheduledTime === startTime
    );

    if (hasConflict) {
      const ok = await showConfirm('Já existe uma atividade agendada neste horário hoje. Deseja colocar lado a lado mesmo assim?', 'Conflito de Horário');
      if (!ok) return;
    }

    await safeUpdate(act.id, {
      scheduledTime: startTime,
      scheduledDate: todayString,
      duration: duration
    });

    overlay.remove();
    if (window.innerWidth < 768) {
      document.getElementById('sidebar').classList.add('hidden');
      document.getElementById('app').classList.remove('sidebar-open');
    }
  });
}

function wasCompletedThisWeek(act) {
  if (!act.completionDate || (act.status !== 'completed' && act.status !== 'partial')) return false;

  const completionDate = new Date(act.completionDate + 'T00:00:00');
  const now = new Date();

  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(now.getDate() - now.getDay());

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return completionDate >= weekStart && completionDate <= weekEnd;
}

// ============================================================================
// GERENCIAMENTO DA LISTA DE ATIVIDADES NO HUB
// ============================================================================
document.getElementById('tab-pending')?.addEventListener('click', () => {
  currentTab = 'pending';
  document.getElementById('tab-pending').classList.add('tab-active');
  document.getElementById('tab-scheduled').classList.remove('tab-active');
  document.getElementById('tab-all').classList.remove('tab-active');
  renderPendingList();
});

document.getElementById('tab-scheduled')?.addEventListener('click', () => {
  currentTab = 'scheduled';
  document.getElementById('tab-scheduled').classList.add('tab-active');
  document.getElementById('tab-pending').classList.remove('tab-active');
  document.getElementById('tab-all').classList.remove('tab-active');
  renderPendingList();
});

document.getElementById('tab-all')?.addEventListener('click', () => {
  currentTab = 'all';
  document.getElementById('tab-all').classList.add('tab-active');
  document.getElementById('tab-pending').classList.remove('tab-active');
  document.getElementById('tab-scheduled').classList.remove('tab-active');
  renderPendingList();
});

// ── GERADOR DE CARDS UNIFICADO ──────────────────
function createActivityCard(act, options = {}) {
  const { showDeadline = true, showSchedule = true } = options;
  const prio = parseInt(act.priority) || 0;
  const div = document.createElement('div');
  div.className = `pending-item priority-item-${prio}`;

  let warningIcon = '';
  if (act.recurrence === 'daily' && !act.scheduledTime) {
    warningIcon = `<i class="fas fa-exclamation-triangle" style="color: var(--warning-color); margin-right: 5px;" title="Atividade diária pendente de agendamento"></i>`;
  }

  const isActive = isActivityActiveToday(act);
  const isCompletedToday = act.status === 'completed' && act.completionDate === todayString;
  
  const statusBadge = ''; // Removido do H3

  const pinIcon = act.scheduledTime ? `<i class="fas fa-thumbtack" style="color: var(--accent-color); margin-right: 5px;" title="Horário Fixado: ${act.scheduledTime}"></i>` : '';

  let deadlineHtml = '';
  if (act.deadline && showDeadline) {
    const [y, m, d] = act.deadline.split('-');
    // Estilo unificado com as outras tags, usando a cor de perigo (vermelho/coral)
    deadlineHtml = `<div style="font-size: 0.72rem; color: var(--danger-color); margin-top: 2px; font-family: 'Chakra Petch', monospace; font-weight: 600;">▶ DATA LIMITE: ${d}/${m}</div>`;
  }

  let scheduleInfoHtml = '';
  if (showSchedule) {
      let progText = '';
      if (act.recurrence === 'weekly' && act.fixedDays && act.fixedDays.length > 0) {
          const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
          const daysStr = act.fixedDays.map(d => dayNames[d]).join(', ');
          progText = `Dias: ${daysStr}`;
      } else if (act.recurrence === 'monthly' && act.monthlyDays) {
          progText = `Dias do mês: ${act.monthlyDays}`;
      } else if (act.recurrence === 'single' && act.scheduledDate) {
          const [y, m, d] = act.scheduledDate.split('-');
          progText = `Data: ${d}/${m}/${y}`;
      }
      
      if (progText) {
          scheduleInfoHtml += `<div style="font-size: 0.72rem; color: var(--accent-color); margin-top: 4px; font-family: 'Chakra Petch', monospace; font-weight: 600;">▶ PROGRAMADA: ${progText.toUpperCase()}</div>`;
      }
  }

  // Marcador de Agendada Hoje (estilo Programada)
  let agendaHojeHtml = '';
  if (isActive && !isCompletedToday) {
    agendaHojeHtml = `<div style="font-size: 0.72rem; color: var(--primary-color); margin-top: 2px; font-family: 'Chakra Petch', monospace; font-weight: 600;">▶ AGENDADA PARA HOJE</div>`;
  }

  // Marcador de Concluída Hoje (estilo unificado)
  let concluidaHojeHtml = '';
  if (isCompletedToday) {
    concluidaHojeHtml = `<div style="font-size: 0.72rem; color: var(--success-color); margin-top: 2px; font-family: 'Chakra Petch', monospace; font-weight: 600;">▶ CONCLUÍDA HOJE</div>`;
  }

  div.innerHTML = `
      <div class="pending-item-inner ${isCompletedToday ? 'completed-today' : ''}">
          <div class="pending-priority-dot prio-dot-${prio}"></div>
          <div style="flex: 1; min-width: 0;">
              <h3>${warningIcon}${pinIcon}${act.title}</h3>
              <span>${act.category || 'Sem categoria'}</span>
              ${deadlineHtml}
              ${concluidaHojeHtml}
              ${agendaHojeHtml}
              ${scheduleInfoHtml}
          </div>
          <button class="btn-delete" style="background:none; border:none; color:var(--text-secondary); font-size:1.1rem; cursor:pointer; padding: 5px; flex-shrink:0;" title="Excluir Atividade">
              <i class="fas fa-trash"></i>
          </button>
      </div>
  `;

  div.querySelector('.btn-delete').addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await showConfirm(`Excluir "${act.title}" definitivamente? Esta ação não pode ser desfeita.`, 'Excluir Atividade');
    if (ok) await safeDelete(act.id);
  });

  div.addEventListener('click', () => {
    showDetailModal(act, !act.scheduledTime);
  });

  return div;
}

function renderPendingList() {
  pendingList.innerHTML = '';
  const searchTerm = document.getElementById('search-activity').value.toLowerCase();
  const selectedCategory = document.getElementById('filter-category').value;
  const sortMode = document.getElementById('sort-activities').value;

  // Persistência e Estilo Visual (Laranja se ativo)
  localStorage.setItem('sidebarFilterCategory', selectedCategory);
  localStorage.setItem('sidebarSortMode', sortMode);
  
  document.getElementById('filter-category').classList.toggle('filter-active', selectedCategory !== '');
  document.getElementById('sort-activities').classList.toggle('filter-active', sortMode !== 'none');

  const [y, m, d] = todayString.split('-');
  const currentDayDate = new Date(y, m - 1, d);

  // 1. ETAPA DE FILTRAGEM (Oculta atividades da lista)
  let filteredActivities = activities.filter(a => {
    const matchSearch = a.title.toLowerCase().includes(searchTerm);
    const matchCat = selectedCategory === '' || a.category === selectedCategory;

    if (!matchSearch || !matchCat) return false;

    // VERIFICADOR DE FUTURO
    let isFutureWeekly = false;
    let isFutureMonthly = false;

    if (a.recurrence === 'weekly' && a.fixedDays && a.fixedDays.length > 0) {
      if (Math.min(...a.fixedDays) > currentDayDate.getDay()) isFutureWeekly = true;
    }
    if (a.recurrence === 'monthly' && a.monthlyDays) {
      const daysArr = a.monthlyDays.split(',').map(d => parseInt(d.trim()));
      if (daysArr.length > 0 && Math.min(...daysArr) > currentDayDate.getDate()) isFutureMonthly = true;
    }
    const isFuture = isFutureWeekly || isFutureMonthly || (a.recurrence === 'single' && a.scheduledDate && a.scheduledDate > todayString);

    const isActiveToday = isActivityActiveToday(a);
    const isScheduledRecurrent = a.scheduledTime || a.recurrence === 'daily' || a.recurrence === 'weekly' || a.recurrence === 'monthly';

    if (currentTab === 'pending') {
      if (isFuture) return false;
      if (isActiveToday) return false;
      
      // Se for recorrente/agendada e não for para hoje nem futuro (ex: dia da semana que já passou), 
      // ela pode aparecer no banco como algo a ser feito manualmente ou simplesmente sumir.
      // Vamos manter a lógica de que se tem horário/recorrência definida, ela deve estar em "Programadas"
      if (isScheduledRecurrent) return false;

      if (a.status === 'completed' && a.recurrence === 'single') return false;
    } else if (currentTab === 'scheduled') {
      // No modo "Programadas", mostramos tudo que tem horário/recorrência mas NÃO é para hoje
      if (!isScheduledRecurrent || isActiveToday) return false;
    }

    return true;
  });

  // 2. ETAPA DE ORDENAÇÃO (Classifica o array filtrado)
  filteredActivities.sort((a, b) => {
    if (sortMode === 'prio-desc') {
      return (parseInt(b.priority) || 0) - (parseInt(a.priority) || 0);
    } 
    else if (sortMode === 'prio-asc') {
      return (parseInt(a.priority) || 0) - (parseInt(b.priority) || 0);
    } 
    else if (sortMode === 'date-asc' || sortMode === 'date-desc') {
      // Atividades sem data limite vão sempre para o final da lista para não poluir
      if (!a.deadline && b.deadline) return 1;
      if (a.deadline && !b.deadline) return -1;
      if (!a.deadline && !b.deadline) return 0;

      const dateA = new Date(a.deadline);
      const dateB = new Date(b.deadline);
      
      return sortMode === 'date-asc' ? dateA - dateB : dateB - dateA;
    }
    else if (sortMode === 'fixed-first') {
      const aFixed = a.scheduledTime ? 1 : 0;
      const bFixed = b.scheduledTime ? 1 : 0;
      return bFixed - aFixed; // Quem for 1 (tem horário) sobe
    }
    // Default ("none"): Ordem Alfabética
    return a.title.localeCompare(b.title);
  });

  // 3. ETAPA DE RENDERIZAÇÃO
  filteredActivities.forEach(act => {
    const card = createActivityCard(act, {
      showDeadline: (sortMode === 'date-asc' || sortMode === 'date-desc'),
      showSchedule: (currentTab === 'scheduled' || currentTab === 'all')
    });
    pendingList.appendChild(card);
  });
}

// ── LÓGICA DA VISÃO GERAL (TODAS AS CATEGORIAS) ──────────────────
const btnFullView = document.getElementById('btn-full-view');
const modalFullView = document.getElementById('modal-full-view');
const fullViewContainer = document.getElementById('full-view-container');

btnFullView?.addEventListener('click', () => {
  renderFullView();
  modalFullView.classList.remove('hidden');
});

function renderFullView() {
  fullViewContainer.innerHTML = '';
  
  const searchTerm = document.getElementById('full-view-search').value.toLowerCase();
  const sortMode = document.getElementById('full-view-sort').value;
  
  // Persistência e Estilo Visual
  localStorage.setItem('fullViewSortMode', sortMode);
  localStorage.setItem('fullViewHideScheduled', fullViewHideScheduled);

  document.getElementById('full-view-sort').classList.toggle('filter-active', sortMode !== 'none');
  const btnHide = document.getElementById('btn-full-view-hide-scheduled');
  if (btnHide) btnHide.classList.toggle('active', fullViewHideScheduled);

  // 1. Filtra as atividades
  let filtered = activities.filter(a => {
    const matchSearch = a.title.toLowerCase().includes(searchTerm);
    const isScheduledToday = isActivityActiveToday(a);
    const matchSchedule = !fullViewHideScheduled || !isScheduledToday;
    return matchSearch && matchSchedule;
  });

  // 2. Ordena as atividades
  filtered.sort((a, b) => {
    if (sortMode === 'prio-desc') return (parseInt(b.priority) || 0) - (parseInt(a.priority) || 0);
    if (sortMode === 'prio-asc') return (parseInt(a.priority) || 0) - (parseInt(b.priority) || 0);
    if (sortMode === 'date-asc' || sortMode === 'date-desc') {
      if (!a.deadline && b.deadline) return 1;
      if (a.deadline && !b.deadline) return -1;
      if (!a.deadline && !b.deadline) return 0;
      return sortMode === 'date-asc' ? new Date(a.deadline) - new Date(b.deadline) : new Date(b.deadline) - new Date(a.deadline);
    }
    if (sortMode === 'fixed-first') {
      const aF = a.scheduledTime ? 1 : 0;
      const bF = b.scheduledTime ? 1 : 0;
      return bF - aF;
    }
    // Default: Ordem Alfabética se nada selecionado
    return a.title.localeCompare(b.title);
  });

  // 3. Agrupa atividades por categoria
  const categoriesMap = {};
  filtered.forEach(a => {
    const cat = a.category || 'Sem categoria';
    if (!categoriesMap[cat]) categoriesMap[cat] = [];
    categoriesMap[cat].push(a);
  });

  // Ordena categorias alfabeticamente
  const sortedCategories = Object.keys(categoriesMap).sort();

  sortedCategories.forEach(catName => {
    const column = document.createElement('div');
    column.className = 'category-column';
    
    const acts = categoriesMap[catName];
    
    column.innerHTML = `
      <div class="category-column-header">
        <h3>${catName}</h3>
        <span style="font-size: 0.7rem; color: var(--text-secondary);">${acts.length}</span>
      </div>
      <div class="category-column-items"></div>
    `;

    const itemsContainer = column.querySelector('.category-column-items');

    acts.forEach(act => {
      const card = createActivityCard(act, {
        showDeadline: true,
        showSchedule: true
      });
      itemsContainer.appendChild(card);
    });

    fullViewContainer.appendChild(column);
  });
}

// Listeners para os controles da Visão Geral
document.getElementById('full-view-search')?.addEventListener('input', renderFullView);
document.getElementById('full-view-sort')?.addEventListener('change', renderFullView);
document.getElementById('btn-full-view-hide-scheduled')?.addEventListener('click', () => {
    fullViewHideScheduled = !fullViewHideScheduled;
    renderFullView();
});

document.getElementById('search-activity').addEventListener('input', renderPendingList);
document.getElementById('filter-category').addEventListener('change', renderPendingList);
document.getElementById('sort-activities').addEventListener('change', renderPendingList);

// Aplicar valores iniciais persistidos
window.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('filter-category')) {
        document.getElementById('filter-category').value = sidebarFilterCategory;
    }
    if (document.getElementById('sort-activities')) {
        document.getElementById('sort-activities').value = sidebarSortMode;
    }
    if (document.getElementById('full-view-sort')) {
        document.getElementById('full-view-sort').value = fullViewSortMode;
    }
});

// ============================================================================
// MENU DE ESTILO (Engrenagem)
// ============================================================================
const btnStyleMenu = document.getElementById('btn-style-menu');
const modalStyle = document.getElementById('modal-style');
const btnCloseStyle = document.getElementById('btn-close-style');
const themeSelect = document.getElementById('theme-select');

btnStyleMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  modalStyle.classList.remove('hidden');
});

btnCloseStyle.addEventListener('click', () => {
  modalStyle.classList.add('hidden');
});

// Fechar modal ao clicar fora
window.addEventListener('click', (e) => {
  if (e.target === modalStyle) {
    modalStyle.classList.add('hidden');
  }
  if (e.target === modalFullView) {
    modalFullView.classList.add('hidden');
  }
});

// Lógica de seleção de tema
themeSelect.addEventListener('change', () => {
  const themeName = themeSelect.value;
  document.body.setAttribute('data-theme', themeName);
  localStorage.setItem('userTheme', themeName);
  // Opcional: fechar modal ao selecionar
  // modalStyle.classList.add('hidden');
});

// Carregar tema salvo
const savedTheme = localStorage.getItem('userTheme');
if (savedTheme) {
  document.body.setAttribute('data-theme', savedTheme);
  themeSelect.value = savedTheme;
}

// ============================================================================
// CRIAÇÃO E AGENDAMENTO DE ATIVIDADES
// ============================================================================
document.getElementById('act-recurrence').addEventListener('change', (e) => {
  const val = e.target.value;
  // Dias do mês: só quando mensal
  document.getElementById('group-monthly-days').classList.toggle('hidden', val !== 'monthly');
  // Dias da semana: só quando semanal
  document.getElementById('group-fixed-days').classList.toggle('hidden', val !== 'weekly');
});

btnNewActivity.addEventListener('click', () => {
  editingActivityId = null;
  isChecklistMode = false;
  document.getElementById('modal-activity-title').innerHTML = '<i class="fas fa-pen-nib"></i> Nova Atividade';
  formActivity.reset();
  setChecklistMode(false);
  document.getElementById('checklist-items-list').innerHTML = '';
  document.getElementById('group-fixed-days').classList.add('hidden');
  document.getElementById('group-monthly-days').classList.add('hidden');
  modalActivity.classList.remove('hidden');
});

// ── Helpers de Checklist ─────────────────────────
function addChecklistItem(text = '') {
  const list = document.getElementById('checklist-items-list');
  const row = document.createElement('div');
  row.className = 'checklist-editor-row';
  const safeText = text.replace(/"/g, '&quot;');
  row.innerHTML = `
        <input type="text" class="checklist-item-text" placeholder="Item da lista..." value="${safeText}">
        <button type="button" class="checklist-item-remove" title="Remover"><i class="fas fa-times"></i></button>
    `;
  row.querySelector('.checklist-item-remove').addEventListener('click', () => row.remove());
  list.appendChild(row);
  return row.querySelector('.checklist-item-text');
}

function getChecklistTexts() {
  return Array.from(document.querySelectorAll('.checklist-item-text'))
    .map(i => i.value.trim()).filter(Boolean);
}

function setChecklistMode(enabled) {
  isChecklistMode = enabled;
  const textarea = document.getElementById('act-details');
  const editor = document.getElementById('act-checklist-editor');
  const btn = document.getElementById('act-toggle-mode');
  if (enabled) {
    textarea.classList.add('hidden');
    editor.classList.remove('hidden');
    btn.innerHTML = '<i class="fas fa-font"></i> Texto';
    btn.classList.add('active');
  } else {
    textarea.classList.remove('hidden');
    editor.classList.add('hidden');
    btn.innerHTML = '<i class="fas fa-list-check"></i> Lista';
    btn.classList.remove('active');
  }
}

document.getElementById('act-toggle-mode').addEventListener('click', () => {
  if (isChecklistMode) {
    // Lista → Texto
    const text = getChecklistTexts().join('\n');
    document.getElementById('act-details').value = text;
    setChecklistMode(false);
  } else {
    // Texto → Lista
    const text = document.getElementById('act-details').value;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    document.getElementById('checklist-items-list').innerHTML = '';
    (lines.length ? lines : ['']).forEach(l => addChecklistItem(l));
    setChecklistMode(true);
  }
});

document.getElementById('act-add-checklist-item').addEventListener('click', () => {
  const input = addChecklistItem();
  input.focus();
});

// Abre o formulário pré-preenchido para edição
function openEditModal(act) {
  editingActivityId = act.id;
  document.getElementById('modal-activity-title').innerHTML = '<i class="fas fa-edit"></i> Editar Atividade';

  document.getElementById('act-title').value = act.title || '';
  document.getElementById('act-category').value = act.category || '';
  document.getElementById('act-recurrence').value = act.recurrence || 'single';
  document.getElementById('act-priority').value = act.priority ?? 0;
  document.getElementById('act-deadline').value = act.deadline || '';
  document.getElementById('act-time').value = act.scheduledTime || '';
  document.getElementById('act-monthly-days').value = act.monthlyDays || '';

  // Horário de término calculado
  if (act.scheduledTime && act.duration) {
    const [h, m] = act.scheduledTime.split(':').map(Number);
    const endMin = h * 60 + m + (act.duration || 0);
    document.getElementById('act-time-end').value =
      `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  } else {
    document.getElementById('act-time-end').value = '';
  }

  // Links
  const links = act.links || [];
  document.getElementById('act-link-1').value = links[0] || '';
  document.getElementById('act-link-2').value = links[1] || '';
  document.getElementById('act-link-3').value = links[2] || '';

  // Modo checklist vs texto
  document.getElementById('checklist-items-list').innerHTML = '';
  if (act.useChecklist && act.checklist?.length) {
    act.checklist.forEach(item => addChecklistItem(item.text));
    setChecklistMode(true);
    isChecklistMode = true;
  } else {
    document.getElementById('act-details').value = act.details || '';
    setChecklistMode(false);
    isChecklistMode = false;
  }

  // Checkboxes dos dias da semana
  document.querySelectorAll('#act-fixed-days input[type="checkbox"]').forEach(cb => {
    cb.checked = (act.fixedDays || []).includes(parseInt(cb.value));
  });

  const rec = act.recurrence || 'single';
  document.getElementById('group-fixed-days').classList.toggle('hidden', rec !== 'weekly');
  document.getElementById('group-monthly-days').classList.toggle('hidden', rec !== 'monthly');
  document.querySelectorAll('details.form-section').forEach(d => d.open = true);
  modalActivity.classList.remove('hidden');
}

formActivity.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!currentUser) { await showAlert('Você precisa estar logado para salvar atividades.', 'Acesso Negado'); return; }

  const links = [
    document.getElementById('act-link-1').value.trim(),
    document.getElementById('act-link-2').value.trim(),
    document.getElementById('act-link-3').value.trim()
  ].filter(Boolean);

  // Modo checklist ou texto
  let detailsText = '';
  let checklistData = null;
  let useChecklist = false;
  if (isChecklistMode) {
    useChecklist = true;
    const texts = getChecklistTexts();
    // Preserva estado 'done' para itens existentes se estivermos editando
    const existingAct = editingActivityId ? activities.find(a => a.id === editingActivityId) : null;
    checklistData = texts.map((text, i) => {
      const existing = existingAct?.checklist?.[i];
      return { text, done: existing?.text === text ? (existing?.done ?? false) : false };
    });
  } else {
    detailsText = document.getElementById('act-details').value;
  }

  // Pega todos os checkboxes marcados para os dias da semana
  const fixedDaysNodes = document.querySelectorAll('#act-fixed-days input:checked');
  const fixedDays = Array.from(fixedDaysNodes).map(cb => parseInt(cb.value));

  const newAct = {
    userId: currentUser.uid,
    title: document.getElementById('act-title').value,
    category: document.getElementById('act-category').value,
    priority: parseInt(document.getElementById('act-priority').value),
    deadline: document.getElementById('act-deadline').value,
    recurrence: document.getElementById('act-recurrence').value,
    details: detailsText,
    useChecklist,
    checklist: checklistData,
    links,
    fixedDays,
    monthlyDays: document.getElementById('act-monthly-days').value,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  const fixedTime = document.getElementById('act-time').value;
  const fixedTimeEnd = document.getElementById('act-time-end').value;
  if (fixedTime) {
    newAct.scheduledTime = fixedTime;
    if (fixedTimeEnd) {
      const [hs, ms] = fixedTime.split(':').map(Number);
      const [he, me] = fixedTimeEnd.split(':').map(Number);
      const dur = (he * 60 + me) - (hs * 60 + ms);
      newAct.duration = dur > 0 ? dur : 60;
    } else {
      newAct.duration = 60;
    }
    if (fixedDays.length === 0 && newAct.recurrence !== 'daily' && newAct.recurrence !== 'monthly') {
      newAct.scheduledDate = todayString;
    }
    const hasConflict = activities.some(a => a.scheduledDate === todayString && a.scheduledTime === fixedTime
      && a.id !== editingActivityId);
    if (hasConflict) {
      const ok = await showConfirm('Já existe uma atividade neste horário. Deseja adicionar mesmo assim?', 'Conflito de Horário');
      if (!ok) return;
    }
  }

  try {
    if (editingActivityId) {
      // MODO EDIÇÃO: atualiza documento existente
      await safeUpdate(editingActivityId, {
        title: newAct.title,
        category: newAct.category,
        priority: newAct.priority,
        deadline: newAct.deadline,
        recurrence: newAct.recurrence,
        details: newAct.details,
        useChecklist: newAct.useChecklist,
        checklist: newAct.checklist,
        links: newAct.links,
        fixedDays: newAct.fixedDays,
        monthlyDays: newAct.monthlyDays,
        ...(newAct.scheduledTime ? { scheduledTime: newAct.scheduledTime } : {}),
        ...(newAct.duration ? { duration: newAct.duration } : {}),
        ...(newAct.scheduledDate ? { scheduledDate: newAct.scheduledDate } : {}),
      });
      editingActivityId = null;
    } else {
      // MODO CRIAÇÃO: novo documento
      await safeAdd(newAct);
    }
    modalActivity.classList.add('hidden');
    isChecklistMode = false;
    setChecklistMode(false);
  } catch (err) {
    console.error(err);
    await showAlert('Erro ao salvar atividade no banco de dados.', 'Erro');
  }
});

// Reset do modo edição ao cancelar
document.querySelectorAll('.close-modal').forEach(btn => {
  btn.addEventListener('click', () => { editingActivityId = null; });
});

// Bot\u00e3o Editar no modal de agendamento
document.getElementById('btn-edit-activity').addEventListener('click', () => {
  if (!pendingActivityToSchedule) return;
  modalSchedule.classList.add('hidden');
  openEditModal(pendingActivityToSchedule);
  pendingActivityToSchedule = null;
});

// Modal de Início e Término
document.getElementById('btn-confirm-schedule').addEventListener('click', async () => {
  const startTime = document.getElementById('sched-start').value;
  const endTime = document.getElementById('sched-end').value;

  if (!startTime || !endTime) {
    await showAlert('Por favor, preencha os horários de início e término.', 'Campos Obrigatórios');
    return;
  }

  const [hStart, mStart] = startTime.split(':').map(Number);
  const [hEnd, mEnd] = endTime.split(':').map(Number);
  const duration = (hEnd * 60 + mEnd) - (hStart * 60 + mStart);

  if (duration <= 0) {
    await showAlert('O horário de término deve ser posterior ao horário de início.', 'Horário Inválido');
    return;
  }

  if (pendingActivityToSchedule) {
    const hasConflict = activities.some(a =>
      a.id !== pendingActivityToSchedule.id &&
      a.scheduledDate === todayString &&
      a.scheduledTime === startTime
    );

    if (hasConflict) {
      const ok = await showConfirm('Já existe uma atividade agendada neste horário hoje. Deseja colocar lado a lado mesmo assim?', 'Conflito de Horário');
      if (!ok) return;
    }

    try {
      await safeUpdate(pendingActivityToSchedule.id, {
        scheduledTime: startTime,
        scheduledDate: todayString,
        duration
      });
      pendingActivityToSchedule = null;
      modalSchedule.classList.add('hidden');
    } catch (e) {
      await showAlert('Erro ao agendar a atividade.', 'Erro');
    }
  }
});

// ============================================================================
// LÓGICA DE CONCLUSÃO (FULL / PARTIAL / RESET)
// ============================================================================
document.getElementById('btn-complete-full').addEventListener('click', async () => {
  if (currentSelectedBlock) {
    let updateData = { status: 'completed', completionDate: todayString };
    if (currentSelectedBlock.useChecklist && currentSelectedBlock.checklist) {
      currentSelectedBlock.checklist.forEach(i => i.done = true);
      updateData.checklist = currentSelectedBlock.checklist;
    }
    await safeUpdate(currentSelectedBlock.id, updateData);
    modalCompletion.classList.add('hidden');
    currentSelectedBlock = null;
  }
});

document.getElementById('btn-complete-partial').addEventListener('click', async () => {
  if (currentSelectedBlock) {
    await safeUpdate(currentSelectedBlock.id, {
      status: 'partial',
      completionDate: todayString
    });
    modalCompletion.classList.add('hidden');
    currentSelectedBlock = null;
  }
});

document.getElementById('btn-complete-reset')?.addEventListener('click', async () => {
  if (currentSelectedBlock) {
    let updateData = { status: 'pending', completionDate: null };
    if (currentSelectedBlock.useChecklist && currentSelectedBlock.checklist) {
      currentSelectedBlock.checklist.forEach(i => i.done = false);
      updateData.checklist = currentSelectedBlock.checklist;
    }
    await safeUpdate(currentSelectedBlock.id, updateData);
    modalCompletion.classList.add('hidden');
    currentSelectedBlock = null;
  }
});