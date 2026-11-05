// Regras da semana independentes do DOM e do Firebase.
export function todayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

export function shiftDate(key, days) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekStart(key = todayKey()) {
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
  return shiftDate(key, -((weekday + 6) % 7));
}

export function emptyWeek(userId, key = todayKey()) {
  return { userId, weekStart: weekStart(key), items: [], omittedActivityIds: [] };
}

export function isExpired(state, key = todayKey()) {
  return Boolean(state && key >= shiftDate(state.weekStart, 7));
}

export function taskItem(activity) {
  return { id: `task_${activity.id}`, activityId: activity.id, title: activity.title, done: false };
}

export function reconcileTracked(state, activities) {
  // Omissões impedem que um snapshot antigo reinsira itens já removidos.
  const omitted = new Set(state.omittedActivityIds || []);
  const linked = new Set(state.items.map(item => item.activityId).filter(Boolean));
  const additions = activities
    .filter(activity => activity.isTracked && !linked.has(activity.id) && !omitted.has(activity.id))
    .map(taskItem);
  return additions.length ? { ...state, items: [...state.items, ...additions] } : state;
}

export function setTracked(state, activity, tracked) {
  const items = state.items.filter(item => item.activityId !== activity.id);
  const existing = state.items.find(item => item.activityId === activity.id);
  const omitted = new Set(state.omittedActivityIds || []);
  if (tracked) {
    omitted.delete(activity.id);
    // Repetir um evento de inclusão não deve desmarcar um item já concluído.
    items.push(existing || taskItem(activity));
  } else {
    omitted.add(activity.id);
  }
  return { ...state, items, omittedActivityIds: [...omitted] };
}

export function beginNewWeek(state, key = todayKey()) {
  if (!isExpired(state, key)) return state;
  const omitted = new Set(state.omittedActivityIds || []);
  state.items.forEach(item => {
    if (item.done && item.activityId) omitted.add(item.activityId);
  });
  return {
    ...state,
    weekStart: weekStart(key),
    items: state.items.filter(item => !item.done),
    omittedActivityIds: [...omitted]
  };
}
