import { getApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  doc,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const firebaseApp = getApp();
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const OCCURRENCE_COLLECTION = 'activity_occurrences';
const MAX_BATCH_SIZE = 400;

let currentUser = auth.currentUser;
let unsubscribeActivities = null;
let previousActivities = new Map();
let maintenanceResetIds = new Set();
let reconciling = false;

let resolveReady;
export const occurrenceHistoryReady = new Promise(resolve => {
  resolveReady = resolve;
});

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

function getHistoryStartKey() {
  const today = parseDateKey(getTodayString());
  return toDateKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));
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

function parseFixedDays(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
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

function occursOn(activity, dateKey) {
  if (!activity || !dateKey) return false;

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

function occurrenceId(userId, activityId, dateKey) {
  return `${userId}__${activityId}__${dateKey}`;
}

function occurrenceSnapshot(activity, dateKey, status, userId) {
  return {
    userId,
    activityId: activity.id,
    date: dateKey,
    status: status || 'pending',
    title: activity.title || 'Sem título',
    category: activity.category || '',
    recurrence: activity.recurrence || 'single',
    scheduledTime: activity.scheduledTime || null,
    duration: activity.duration ?? null,
    priority: activity.priority ?? 0,
    recordedAt: new Date().toISOString()
  };
}

async function commitOperations(operations) {
  for (let start = 0; start < operations.length; start += MAX_BATCH_SIZE) {
    const batch = writeBatch(db);
    operations.slice(start, start + MAX_BATCH_SIZE).forEach(operation => {
      if (operation.type === 'set') {
        batch.set(operation.ref, operation.data, { merge: true });
      } else if (operation.type === 'delete') {
        batch.delete(operation.ref);
      } else if (operation.type === 'update') {
        batch.update(operation.ref, operation.data);
      }
    });
    await batch.commit();
  }
}

async function loadOccurrenceMap(userId) {
  const snapshot = await getDocs(query(
    collection(db, OCCURRENCE_COLLECTION),
    where('userId', '==', userId)
  ));

  const map = new Map();
  snapshot.docs.forEach(item => {
    const data = item.data();
    map.set(item.id, { id: item.id, ...data });
  });
  return map;
}

async function reconcileActivities(activities, { initial = false } = {}) {
  if (!currentUser || reconciling) return;
  reconciling = true;

  try {
    const userId = currentUser.uid;
    const todayKey = getTodayString();
    const historyStartKey = getHistoryStartKey();
    const occurrenceMap = await loadOccurrenceMap(userId);
    const operations = [];

    // Mantém somente o mês atual e o mês anterior no histórico persistido.
    occurrenceMap.forEach((occurrence, id) => {
      if (occurrence.date && occurrence.date < historyStartKey) {
        operations.push({
          type: 'delete',
          ref: doc(db, OCCURRENCE_COLLECTION, id)
        });
        occurrenceMap.delete(id);
      }
    });

    for (const activity of activities) {
      const currentStatus = activity.status;
      const completionDate = activity.completionDate;

      // Converte o estado legado/global em uma ocorrência datada antes de qualquer reset.
      if (
        (currentStatus === 'completed' || currentStatus === 'partial') &&
        completionDate &&
        completionDate >= historyStartKey &&
        completionDate <= todayKey
      ) {
        const id = occurrenceId(userId, activity.id, completionDate);
        const data = occurrenceSnapshot(activity, completionDate, currentStatus, userId);
        operations.push({
          type: 'set',
          ref: doc(db, OCCURRENCE_COLLECTION, id),
          data
        });
        occurrenceMap.set(id, { id, ...data });
      }

      // Se uma tarefa única ficou para trás, sabemos que aquela obrigação existiu e preservamos seu estado conhecido.
      if (
        activity.recurrence === 'single' &&
        activity.scheduledDate &&
        activity.scheduledDate >= historyStartKey &&
        activity.scheduledDate < todayKey
      ) {
        const id = occurrenceId(userId, activity.id, activity.scheduledDate);
        if (!occurrenceMap.has(id)) {
          const knownStatus = currentStatus === 'completed' || currentStatus === 'partial' ? currentStatus : 'pending';
          const data = occurrenceSnapshot(activity, activity.scheduledDate, knownStatus, userId);
          operations.push({
            type: 'set',
            ref: doc(db, OCCURRENCE_COLLECTION, id),
            data
          });
          occurrenceMap.set(id, { id, ...data });
        }
      }

      // Backfill do mês anterior e do mês atual. Para datas anteriores à implantação,
      // não inventamos se a obrigação foi cumprida: sem evidência, fica como "unknown".
      let cursor = parseDateKey(historyStartKey);
      const end = parseDateKey(todayKey);
      while (cursor <= end) {
        const dateKey = toDateKey(cursor);
        if (occursOn(activity, dateKey)) {
          const id = occurrenceId(userId, activity.id, dateKey);
          if (!occurrenceMap.has(id)) {
            let status = dateKey < todayKey ? 'unknown' : 'pending';
            if (completionDate === dateKey && (currentStatus === 'completed' || currentStatus === 'partial')) {
              status = currentStatus;
            }
            const data = occurrenceSnapshot(activity, dateKey, status, userId);
            operations.push({
              type: 'set',
              ref: doc(db, OCCURRENCE_COLLECTION, id),
              data
            });
            occurrenceMap.set(id, { id, ...data });
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      // Recorrências são independentes por data. No dia seguinte, libera a atividade para a próxima ocorrência.
      if (
        activity.recurrence !== 'single' &&
        currentStatus !== 'pending' &&
        completionDate &&
        completionDate < todayKey
      ) {
        const resetData = { status: 'pending', completionDate: null };
        if (activity.useChecklist && Array.isArray(activity.checklist)) {
          resetData.checklist = activity.checklist.map(item => ({ ...item, done: false }));
        }

        maintenanceResetIds.add(activity.id);
        operations.push({
          type: 'update',
          ref: doc(db, 'activities', activity.id),
          data: resetData
        });
      }
    }

    await commitOperations(operations);

    if (initial) {
      previousActivities = new Map(activities.map(activity => [activity.id, activity]));
    }
  } catch (error) {
    console.error('Falha ao reconciliar histórico de ocorrências:', error);
  } finally {
    reconciling = false;
  }
}

async function processActivitySnapshot(snapshot) {
  const activities = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  const todayKey = getTodayString();

  // Detecta desmarcação manual no mesmo dia e devolve a ocorrência histórica para pendente.
  for (const activity of activities) {
    const previous = previousActivities.get(activity.id);
    if (!previous) continue;

    const wasMarked = previous.status === 'completed' || previous.status === 'partial';
    const isNowPending = activity.status === 'pending' && !activity.completionDate;
    const wasToday = previous.completionDate === todayKey;

    if (wasMarked && isNowPending && wasToday && !maintenanceResetIds.has(activity.id)) {
      try {
        await setDoc(
          doc(db, OCCURRENCE_COLLECTION, occurrenceId(currentUser.uid, activity.id, todayKey)),
          occurrenceSnapshot(activity, todayKey, 'pending', currentUser.uid),
          { merge: true }
        );
      } catch (error) {
        console.error('Falha ao desmarcar ocorrência:', error);
      }
    }

    maintenanceResetIds.delete(activity.id);
  }

  await reconcileActivities(activities);
  previousActivities = new Map(activities.map(activity => [activity.id, activity]));
}

async function initializeForCurrentUser() {
  currentUser = auth.currentUser;
  if (!currentUser) {
    resolveReady?.();
    return;
  }

  try {
    const activitiesQuery = query(
      collection(db, 'activities'),
      where('userId', '==', currentUser.uid)
    );

    const initialSnapshot = await getDocs(activitiesQuery);
    const initialActivities = initialSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    await reconcileActivities(initialActivities, { initial: true });

    unsubscribeActivities = onSnapshot(activitiesQuery, snapshot => {
      processActivitySnapshot(snapshot).catch(error => {
        console.error('Falha ao acompanhar ocorrências:', error);
      });
    });
  } catch (error) {
    console.error('Não foi possível inicializar o histórico de ocorrências:', error);
  } finally {
    resolveReady?.();
  }
}

await initializeForCurrentUser();

// Se o app ficar aberto durante a virada do dia, executa a mesma reconciliação ao voltar para a tela.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !currentUser) return;
  try {
    const snapshot = await getDocs(query(
      collection(db, 'activities'),
      where('userId', '==', currentUser.uid)
    ));
    await reconcileActivities(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  } catch (error) {
    console.error('Falha ao atualizar ocorrências ao retomar o app:', error);
  }
});

window.setInterval(async () => {
  if (!currentUser || document.visibilityState !== 'visible') return;
  try {
    const snapshot = await getDocs(query(
      collection(db, 'activities'),
      where('userId', '==', currentUser.uid)
    ));
    await reconcileActivities(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  } catch (error) {
    console.error('Falha na manutenção periódica das ocorrências:', error);
  }
}, 60 * 60 * 1000);
