import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC-iFjByyV-QLGP253kdlJYVqvryw1BI2E",
  authDomain: "planejamentosemanal-6d1dc.firebaseapp.com",
  projectId: "planejamentosemanal-6d1dc",
  storageBucket: "planejamentosemanal-6d1dc.firebasestorage.app",
  messagingSenderId: "537704966796",
  appId: "1:537704966796:web:74b8c137790698f7f8a9a9"
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const LONG_PRESS_MS = 560;
const MOVE_TOLERANCE = 12;
const MAX_BATCH_SIZE = 400;
const CALENDAR_FILTER_KEY = 'rotinaos.calendar.categoryFilter.v1';

let currentUser = auth.currentUser;
let pressTimer = null;
let pressTarget = null;
let pressStartX = 0;
let pressStartY = 0;
let longPressTriggered = false;
let suppressClicksUntil = 0;
let activeEditor = null;

onAuthStateChanged(auth, user => {
  currentUser = user;
});

function isTouchLikeEvent(event) {
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

function getCategoryHeading(target) {
  return target?.closest?.('.category-column-header h3') || null;
}

function displayedCategoryName(heading) {
  return String(heading?.dataset?.categoryOriginal || heading?.textContent || '').trim();
}

function matchesCategory(value, displayedName) {
  const normalized = String(value || '').trim();
  if (displayedName === 'Sem categoria') return normalized === '' || normalized === 'Sem categoria';
  return normalized === displayedName;
}

function showToast(message, isError = false) {
  document.querySelector('.category-rename-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `category-rename-toast${isError ? ' is-error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 180);
  }, 2200);
}

async function commitCategoryUpdates(refs, newName) {
  for (let start = 0; start < refs.length; start += MAX_BATCH_SIZE) {
    const batch = writeBatch(db);
    refs.slice(start, start + MAX_BATCH_SIZE).forEach(ref => {
      batch.update(ref, { category: newName });
    });
    await batch.commit();
  }
}

function migrateLocalCategoryPreferences(oldName, newName) {
  try {
    const collapsed = JSON.parse(localStorage.getItem('collapsedCategories') || '[]');
    if (Array.isArray(collapsed) && collapsed.includes(oldName)) {
      const next = [...new Set(collapsed.map(item => item === oldName ? newName : item))];
      localStorage.setItem('collapsedCategories', JSON.stringify(next));
    }
  } catch (_) {}

  if (localStorage.getItem('sidebarFilterCategory') === oldName) {
    localStorage.setItem('sidebarFilterCategory', newName);
  }

  try {
    const calendarFilter = JSON.parse(localStorage.getItem(CALENDAR_FILTER_KEY) || 'null');
    if (calendarFilter?.mode === 'selected' && Array.isArray(calendarFilter.categories)) {
      const categories = [...new Set(
        calendarFilter.categories.map(item => item === oldName ? newName : item)
      )].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      localStorage.setItem(CALENDAR_FILTER_KEY, JSON.stringify({ ...calendarFilter, categories }));
    }
  } catch (_) {}
}

async function renameCategory(oldName, newName) {
  if (!currentUser) throw new Error('Usuário não autenticado.');

  const userId = currentUser.uid;
  const userQuery = collectionName => query(
    collection(db, collectionName),
    where('userId', '==', userId)
  );

  const [activitiesSnapshot, occurrencesSnapshot] = await Promise.all([
    getDocs(userQuery('activities')),
    getDocs(userQuery('activity_occurrences'))
  ]);

  const activityRefs = activitiesSnapshot.docs
    .filter(item => matchesCategory(item.data().category, oldName))
    .map(item => item.ref);

  const occurrenceRefs = occurrencesSnapshot.docs
    .filter(item => matchesCategory(item.data().category, oldName))
    .map(item => item.ref);

  await commitCategoryUpdates([...activityRefs, ...occurrenceRefs], newName);
  migrateLocalCategoryPreferences(oldName, newName);

  return activityRefs.length;
}

function finishEditor({ restoreName = null } = {}) {
  if (!activeEditor) return;
  const { heading, oldName } = activeEditor;
  if (heading?.isConnected) {
    heading.classList.remove('category-renaming');
    heading.dataset.categoryOriginal = restoreName ?? oldName;
    heading.textContent = restoreName ?? oldName;
  }
  activeEditor = null;
}

function startEditor(heading) {
  if (!heading || activeEditor) return;

  const oldName = displayedCategoryName(heading);
  if (!oldName) return;

  heading.dataset.categoryOriginal = oldName;
  heading.classList.add('category-renaming');
  heading.textContent = '';

  const editor = document.createElement('span');
  editor.className = 'category-rename-editor';

  const input = document.createElement('input');
  input.className = 'category-rename-input';
  input.type = 'text';
  input.maxLength = 80;
  input.value = oldName === 'Sem categoria' ? '' : oldName;
  input.placeholder = 'Nome da categoria';
  input.setAttribute('aria-label', `Renomear categoria ${oldName}`);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'category-rename-action is-save';
  save.title = 'Salvar nome';
  save.setAttribute('aria-label', 'Salvar nome da categoria');
  save.innerHTML = '<i class="fas fa-check"></i>';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'category-rename-action is-cancel';
  cancel.title = 'Cancelar';
  cancel.setAttribute('aria-label', 'Cancelar edição da categoria');
  cancel.innerHTML = '<i class="fas fa-times"></i>';

  editor.append(input, save, cancel);
  heading.appendChild(editor);
  activeEditor = { heading, input, save, cancel, oldName, busy: false };

  const commit = async () => {
    if (!activeEditor || activeEditor.busy) return;
    const newName = input.value.trim();

    if (!newName) {
      input.classList.add('is-invalid');
      input.focus();
      return;
    }

    if (newName === oldName) {
      finishEditor({ restoreName: oldName });
      return;
    }

    activeEditor.busy = true;
    input.disabled = true;
    save.disabled = true;
    cancel.disabled = true;
    heading.classList.add('is-saving');

    try {
      const changedCount = await renameCategory(oldName, newName);
      finishEditor({ restoreName: newName });
      showToast(`Categoria renomeada em ${changedCount} ${changedCount === 1 ? 'atividade' : 'atividades'}.`);
    } catch (error) {
      console.error('Falha ao renomear categoria:', error);
      heading.classList.remove('is-saving');
      input.disabled = false;
      save.disabled = false;
      cancel.disabled = false;
      activeEditor.busy = false;
      input.focus();
      showToast('Não foi possível renomear a categoria.', true);
    }
  };

  save.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    commit();
  });

  cancel.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    finishEditor({ restoreName: oldName });
  });

  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishEditor({ restoreName: oldName });
    }
  });

  requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
    input.select();
  });
}

function cancelPress() {
  if (pressTimer) window.clearTimeout(pressTimer);
  pressTimer = null;
  pressTarget = null;
}

// Mobile/tablet: segurar o nome. Cancela se o dedo se mover para não brigar com o scroll horizontal.
document.addEventListener('pointerdown', event => {
  if (!isTouchLikeEvent(event) || activeEditor) return;
  const heading = getCategoryHeading(event.target);
  if (!heading) return;

  cancelPress();
  pressTarget = heading;
  pressStartX = event.clientX;
  pressStartY = event.clientY;
  longPressTriggered = false;

  pressTimer = window.setTimeout(() => {
    if (!pressTarget?.isConnected) return;
    longPressTriggered = true;
    suppressClicksUntil = Date.now() + 900;

    try {
      if (navigator.vibrate) navigator.vibrate(35);
    } catch (_) {}

    pressTarget.classList.add('category-rename-shake');
    const target = pressTarget;
    window.setTimeout(() => {
      target.classList.remove('category-rename-shake');
      startEditor(target);
    }, 170);
  }, LONG_PRESS_MS);
}, { passive: true });

document.addEventListener('pointermove', event => {
  if (!pressTimer || !pressTarget) return;
  const moved = Math.hypot(event.clientX - pressStartX, event.clientY - pressStartY);
  if (moved > MOVE_TOLERANCE) cancelPress();
}, { passive: true });

document.addEventListener('pointerup', cancelPress, { passive: true });
document.addEventListener('pointercancel', cancelPress, { passive: true });

// Desktop: duplo clique no nome. O clique simples sobre o nome não recolhe a coluna;
// o restante do cabeçalho mantém o comportamento original de expandir/recolher.
document.addEventListener('click', event => {
  const heading = getCategoryHeading(event.target);
  const insideEditor = event.target.closest?.('.category-rename-editor');

  if (insideEditor || (heading && activeEditor?.heading === heading)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (Date.now() < suppressClicksUntil && event.target.closest?.('.category-column-header')) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (heading && event.pointerType !== 'touch' && !matchMedia('(pointer: coarse)').matches) {
    event.stopPropagation();
  }
}, true);

document.addEventListener('dblclick', event => {
  const heading = getCategoryHeading(event.target);
  if (!heading || matchMedia('(pointer: coarse)').matches) return;
  event.preventDefault();
  event.stopPropagation();
  heading.classList.add('category-rename-shake');
  window.setTimeout(() => {
    heading.classList.remove('category-rename-shake');
    startEditor(heading);
  }, 140);
}, true);

function enhanceCategoryHeadings() {
  document.querySelectorAll('.category-column-header h3').forEach(heading => {
    if (heading.dataset.categoryRenameReady === 'true') return;
    heading.dataset.categoryRenameReady = 'true';
    heading.dataset.categoryOriginal = String(heading.textContent || '').trim();
    heading.title = matchMedia('(pointer: coarse)').matches
      ? 'Pressione e segure para renomear'
      : 'Duplo clique para renomear';
  });
}

enhanceCategoryHeadings();
new MutationObserver(enhanceCategoryHeadings).observe(document.documentElement, {
  childList: true,
  subtree: true
});
