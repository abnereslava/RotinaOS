import "./firebase-init.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const firebaseApp = getApp();
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// O app legado transforma uma data vazia em "hoje" no submit. Para preservar
// a semântica opcional sem reescrever o formulário inteiro, usamos um valor
// temporário fora da janela normal do calendário e o normalizamos para null
// assim que o Firestore recebe a gravação.
const EMPTY_DATE_SENTINEL = '2099-12-31';

let currentUser = null;
let unsubscribeActivities = null;
let knownSentinelIds = new Set();
let pendingNormalization = null;

function installDateClearButton() {
  const input = document.getElementById('act-date');
  const group = document.getElementById('group-single-date');
  if (!input || !group || document.getElementById('btn-clear-act-date')) return;

  const row = document.createElement('div');
  row.className = 'optional-date-row';

  input.parentNode.insertBefore(row, input);
  row.appendChild(input);

  const button = document.createElement('button');
  button.id = 'btn-clear-act-date';
  button.type = 'button';
  button.className = 'btn-secondary optional-date-clear';
  button.title = 'Limpar data de agendamento';
  button.setAttribute('aria-label', 'Limpar data de agendamento');
  button.innerHTML = '<i class="fas fa-eraser"></i><span>Limpar</span>';

  button.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus({ preventScroll: true });
  });

  row.appendChild(button);
}

function normalizePendingSentinel(snapshot) {
  const sentinelIds = new Set();
  snapshot.forEach(item => {
    if (item.data().scheduledDate === EMPTY_DATE_SENTINEL) sentinelIds.add(item.id);
  });

  if (pendingNormalization) {
    const candidates = [...sentinelIds].filter(id => !pendingNormalization.baseline.has(id));

    if (candidates.length > 0) {
      const request = pendingNormalization;
      pendingNormalization = null;

      Promise.all(
        candidates.map(id => updateDoc(doc(db, 'activities', id), { scheduledDate: null }))
      ).catch(error => {
        console.error('Falha ao limpar data opcional de agendamento:', error);
        pendingNormalization = request;
      });
    } else if (Date.now() > pendingNormalization.expiresAt) {
      pendingNormalization = null;
    }
  }

  knownSentinelIds = sentinelIds;
}

function bindOptionalDateSubmitFix() {
  const form = document.getElementById('form-activity');
  const input = document.getElementById('act-date');
  const recurrence = document.getElementById('act-recurrence');
  if (!form || !input || !recurrence || form.dataset.optionalDateBound === 'true') return;

  form.dataset.optionalDateBound = 'true';

  // Capture roda antes do listener legado do app.js. Se a data estiver vazia,
  // impedimos o fallback automático para hoje. O valor é restaurado visualmente
  // logo depois que o handler legado já leu o formulário.
  form.addEventListener('submit', () => {
    if (recurrence.value !== 'single' || input.value) return;

    pendingNormalization = {
      baseline: new Set(knownSentinelIds),
      expiresAt: Date.now() + 30000
    };

    input.value = EMPTY_DATE_SENTINEL;
    input.dataset.optionalDateSentinel = 'true';

    window.setTimeout(() => {
      if (input.dataset.optionalDateSentinel === 'true' && input.value === EMPTY_DATE_SENTINEL) {
        input.value = '';
      }
      delete input.dataset.optionalDateSentinel;
    }, 0);
  }, true);
}

function initializeOptionalDateUi() {
  installDateClearButton();
  bindOptionalDateSubmitFix();
}

initializeOptionalDateUi();
document.addEventListener('DOMContentLoaded', initializeOptionalDateUi, { once: true });

const observer = new MutationObserver(() => initializeOptionalDateUi());
observer.observe(document.documentElement, { childList: true, subtree: true });

onAuthStateChanged(auth, user => {
  currentUser = user;
  unsubscribeActivities?.();
  unsubscribeActivities = null;
  knownSentinelIds = new Set();
  pendingNormalization = null;

  if (!currentUser) return;

  const activitiesQuery = query(
    collection(db, 'activities'),
    where('userId', '==', currentUser.uid)
  );

  unsubscribeActivities = onSnapshot(
    activitiesQuery,
    normalizePendingSentinel,
    error => console.error('Falha ao acompanhar datas opcionais:', error)
  );
});
