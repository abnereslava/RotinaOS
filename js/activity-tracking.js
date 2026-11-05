import './weekly-checklist.js';
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

const LONG_PRESS_MS = 540;
const MOVE_TOLERANCE_PX = 11;

let activities = [];
let activityById = new Map();
let unsubscribeActivities = null;
let renderScheduled = false;
let activePress = null;
let suppressClickCard = null;
let suppressClickUntil = 0;
const trackingBusy = new Set();

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function setActivities(nextActivities) {
  activities = Array.isArray(nextActivities)
    ? nextActivities.map(item => ({ ...item }))
    : [];
  activityById = new Map(activities.map(activity => [activity.id, activity]));
  scheduleApply();
}

function applyTrackingStateToCards() {
  renderScheduled = false;
  const cards = [...document.querySelectorAll('.full-view-columns .pending-item')];
  if (!cards.length) return;

  cards.forEach(card => {
    const activity = activityById.get(card.dataset.activityId);

    if (!activity) {
      card.classList.remove('is-tracked');
      card.removeAttribute('aria-label');
      return;
    }

    card.dataset.activityId = activity.id;
    card.classList.toggle('is-tracked', Boolean(activity.isTracked));
    card.setAttribute(
      'aria-label',
      `${normalize(activity.title)}. ${activity.isTracked ? 'Atividade acompanhada.' : 'Atividade não acompanhada.'}`
    );
  });
}

function scheduleApply() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(applyTrackingStateToCards);
}

function pulse(card) {
  card.classList.add('tracking-pulse');
  window.setTimeout(() => card.classList.remove('tracking-pulse'), 180);
}

async function toggleTracking(card) {
  const id = card?.dataset.activityId;
  const activity = id ? activityById.get(id) : null;
  if (!id || !activity || trackingBusy.has(id)) return;
  trackingBusy.add(id);

  const previous = Boolean(activity.isTracked);
  const next = !previous;

  activity.isTracked = next;
  card.classList.toggle('is-tracked', next);
  card.setAttribute(
    'aria-label',
    `${normalize(activity.title)}. ${next ? 'Atividade acompanhada.' : 'Atividade não acompanhada.'}`
  );
  pulse(card);

  try {
    navigator.vibrate?.(35);
  } catch (_) {}

  try {
    await window.RotinaWeeklyChecklist.setTrackedActivity(activity, next);
  } catch (error) {
    window.RotinaWeeklyChecklist.showError(error);
    activity.isTracked = previous;
    card.classList.toggle('is-tracked', previous);
    card.setAttribute(
      'aria-label',
      `${normalize(activity.title)}. ${previous ? 'Atividade acompanhada.' : 'Atividade não acompanhada.'}`
    );
  } finally {
    trackingBusy.delete(id);
  }
}

function isInteractiveTarget(target) {
  return Boolean(target?.closest?.('button, a, input, select, textarea, label, [contenteditable="true"], .btn-delete'));
}

function cancelActivePress() {
  if (!activePress) return;
  window.clearTimeout(activePress.timer);
  activePress = null;
}

document.addEventListener('pointerdown', event => {
  const card = event.target?.closest?.('.full-view-columns .pending-item');
  if (!card || isInteractiveTarget(event.target)) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  cancelActivePress();

  const press = {
    card,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    fired: false,
    timer: null
  };

  press.timer = window.setTimeout(() => {
    if (!card.isConnected || !card.dataset.activityId) return;
    press.fired = true;
    suppressClickCard = card;
    suppressClickUntil = performance.now() + 1000;
    toggleTracking(card);
  }, LONG_PRESS_MS);

  activePress = press;
}, true);

document.addEventListener('pointermove', event => {
  if (!activePress || event.pointerId !== activePress.pointerId || activePress.fired) return;
  const dx = event.clientX - activePress.startX;
  const dy = event.clientY - activePress.startY;
  if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) cancelActivePress();
}, true);

['pointerup', 'pointercancel'].forEach(type => {
  document.addEventListener(type, event => {
    if (!activePress || event.pointerId !== activePress.pointerId) return;
    cancelActivePress();
  }, true);
});

document.addEventListener('click', event => {
  const card = event.target?.closest?.('.full-view-columns .pending-item');
  if (!card || card !== suppressClickCard || performance.now() > suppressClickUntil) return;

  suppressClickCard = null;
  suppressClickUntil = 0;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

// Evita o menu de contexto do navegador durante o pressionar-e-segurar no touch.
document.addEventListener('contextmenu', event => {
  if (!navigator.maxTouchPoints) return;
  if (event.target?.closest?.('.full-view-columns .pending-item')) event.preventDefault();
}, true);

const observer = new MutationObserver(mutations => {
  if (mutations.some(mutation => mutation.type === 'childList')) scheduleApply();
});
observer.observe(document.body, { childList: true, subtree: true });

// O modo visitante mantém a mesma API visual, mas recebe a coleção do núcleo local.
document.addEventListener('rotinaos:demo-activities', event => {
  if (!window.__ROTINAOS_DEMO__) return;
  setActivities(event.detail?.activities || []);
});

onAuthStateChanged(auth, user => {
  unsubscribeActivities?.();
  unsubscribeActivities = null;

  if (window.__ROTINAOS_DEMO__) {
    setActivities(window.__ROTINAOS_DEMO_ACTIVITIES__ || []);
    return;
  }

  setActivities([]);
  if (!user) return;

  unsubscribeActivities = onSnapshot(
    query(collection(db, 'activities'), where('userId', '==', user.uid)),
    snapshot => {
      setActivities(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
    },
    error => console.error('Falha ao carregar atividades acompanhadas:', error)
  );
});

if (window.__ROTINAOS_DEMO__ && Array.isArray(window.__ROTINAOS_DEMO_ACTIVITIES__)) {
  setActivities(window.__ROTINAOS_DEMO_ACTIVITIES__);
} else {
  scheduleApply();
}
