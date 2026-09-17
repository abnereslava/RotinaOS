// Carrega o núcleo legado com pequenas correções de compatibilidade em runtime.
// Isso permite manter um único núcleo de UI e, ao mesmo tempo, fazer o modo demo
// conversar com os módulos modernos sem qualquer acesso ao Firestore.

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Não foi possível aplicar compatibilidade do núcleo: ${label}`);
  }
  return source.replace(search, replacement);
}

function patchCoreSource(source) {
  let patched = source;

  // Data de agendamento realmente opcional, tanto na criação quanto na edição.
  patched = replaceRequired(
    patched,
    "newAct.scheduledDate = document.getElementById('act-date').value || todayString;",
    "newAct.scheduledDate = document.getElementById('act-date').value || null;",
    'data opcional na criação'
  );

  patched = replaceRequired(
    patched,
    "...(newAct.scheduledDate ? { scheduledDate: newAct.scheduledDate } : {}),",
    "scheduledDate: newAct.recurrence === 'single' ? (newAct.scheduledDate || null) : null,",
    'data opcional na edição'
  );

  // O demo deve começar usando exatamente o mesmo conjunto publicado pelo bootstrap.
  patched = replaceRequired(
    patched,
    "activities = mockActivities.map(a => {",
    "activities = (Array.isArray(window.__ROTINAOS_DEMO_ACTIVITIES__) ? window.__ROTINAOS_DEMO_ACTIVITIES__ : mockActivities).map(a => {",
    'fonte de dados da demonstração'
  );

  // Toda mutação local do demo passa a notificar os módulos modernos.
  patched = replaceRequired(
    patched,
    "if (idx !== -1) activities[idx] = { ...activities[idx], ...data };\n        refreshUI();\n        return;",
    "if (idx !== -1) activities[idx] = { ...activities[idx], ...data };\n        refreshUI();\n        publishDemoState();\n        return;",
    'sincronização de atualização demo'
  );

  patched = replaceRequired(
    patched,
    "activities = activities.filter(a => a.id !== id);\n        refreshUI();\n        return;",
    "activities = activities.filter(a => a.id !== id);\n        refreshUI();\n        publishDemoState();\n        return;",
    'sincronização de exclusão demo'
  );

  patched = replaceRequired(
    patched,
    "activities.push({ id: newId, ...data });\n        refreshUI();\n        return;",
    "activities.push({ id: newId, ...data });\n        refreshUI();\n        publishDemoState();\n        return;",
    'sincronização de criação demo'
  );

  patched = replaceRequired(
    patched,
    "refreshUI();\n    \n    document.getElementById('modal-demo-notice').classList.remove('hidden');",
    "refreshUI();\n    publishDemoState();\n    \n    document.getElementById('modal-demo-notice').classList.remove('hidden');",
    'sincronização inicial demo'
  );

  // API pequena e deliberada para recursos modernos que antes dependiam do Firestore.
  patched += `\n\n// === RotinaOS demo bridge (injetado por core-loader.js) ===\nfunction publishDemoState() {\n  if (!isDemoMode) return;\n  const snapshot = activities.map(item => ({ ...item }));\n  window.__ROTINAOS_DEMO_ACTIVITIES__ = snapshot;\n  document.dispatchEvent(new CustomEvent('rotinaos:demo-activities', {\n    detail: { activities: snapshot.map(item => ({ ...item })) }\n  }));\n}\n\nwindow.RotinaDemoCore = {\n  isActive: () => isDemoMode,\n  getActivities: () => activities.map(item => ({ ...item })),\n  updateActivity: async (id, data) => {\n    if (!isDemoMode) return false;\n    await safeUpdate(id, data);\n    return true;\n  },\n  deleteActivity: async (id) => {\n    if (!isDemoMode) return false;\n    await safeDelete(id);\n    return true;\n  },\n  renameCategory: async (oldName, newName) => {\n    if (!isDemoMode) return 0;\n    const normalize = value => String(value || '').trim();\n    let changed = 0;\n    activities = activities.map(activity => {\n      const category = normalize(activity.category) || 'Sem categoria';\n      if (category !== oldName) return activity;\n      changed += 1;\n      return { ...activity, category: newName };\n    });\n    refreshUI();\n    publishDemoState();\n    return changed;\n  },\n  refresh: () => {\n    if (!isDemoMode) return;\n    refreshUI();\n    publishDemoState();\n  }\n};\n`;

  return patched;
}

export async function loadCore() {
  const response = await fetch('./js/app-core.js', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Falha ao carregar núcleo do app (${response.status}).`);

  const source = await response.text();
  const patched = patchCoreSource(source);
  const blob = new Blob([patched], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);

  try {
    await import(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
