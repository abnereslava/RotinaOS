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

  // Atividade única pendente que ficou para trás volta ao Banco sem carregar
  // o agendamento antigo para o dia seguinte.
  patched = replaceRequired(
    patched,
    "promises.push(safeUpdate(a.id, { scheduledDate: todayString }));",
    "promises.push(safeUpdate(a.id, { scheduledDate: null, scheduledTime: null, duration: null }));",
    'atividade única vencida volta ao banco'
  );

  // No agendamento rápido pelo detalhe, término é opcional. Sem término,
  // duration fica null e a agenda renderiza o card aberto/tracejado.
  patched = replaceRequired(
    patched,
    '<label style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 4px;">Término</label>\\n                        <input type="time" id="detail-sched-end" value="${endVal}" style="padding: 8px; font-size: 0.95rem; border: 2px solid var(--border-color); background: var(--bg-color); color: var(--text-primary); width: 100%; font-family: \'Rajdhani\', sans-serif;" required>',
    '<label style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 4px;">Término (Opcional)</label>\\n                        <input type="time" id="detail-sched-end" value="${endVal}" style="padding: 8px; font-size: 0.95rem; border: 2px solid var(--border-color); background: var(--bg-color); color: var(--text-primary); width: 100%; font-family: \'Rajdhani\', sans-serif;">',
    'término opcional no detalhe'
  );

  patched = replaceRequired(
    patched,
    `    if (!startTime || !endTime) {
      await showAlert('Por favor, preencha os horários de início e término.', 'Campos Obrigatórios');
      return;
    }

    const [hStart, mStart] = startTime.split(':').map(Number);
    const [hEnd, mEnd] = endTime.split(':').map(Number);
    const duration = (hEnd * 60 + mEnd) - (hStart * 60 + mStart);

    if (duration <= 0) {
      await showAlert('O horário de término deve ser posterior ao horário de início.', 'Horário Inválido');
      return;
    }`,
    `    if (!startTime) {
      await showAlert('Por favor, preencha o horário de início.', 'Campo Obrigatório');
      return;
    }

    let duration = null;
    if (endTime) {
      const [hStart, mStart] = startTime.split(':').map(Number);
      const [hEnd, mEnd] = endTime.split(':').map(Number);
      duration = (hEnd * 60 + mEnd) - (hStart * 60 + mStart);

      if (duration <= 0) {
        await showAlert('O horário de término deve ser posterior ao horário de início.', 'Horário Inválido');
        return;
      }
    }`,
    'salvar agendamento sem término'
  );

  // Durante a demo o Auth real não pode esconder o app por não existir sessão Firebase.
  patched = replaceRequired(
    patched,
    "onAuthStateChanged(auth, (user) => {\n  if (user) {",
    "onAuthStateChanged(auth, (user) => {\n  if (window.__ROTINAOS_DEMO__) return;\n  if (user) {",
    'ignorar Auth real durante demonstração'
  );

  // O demo deve começar usando exatamente o mesmo conjunto publicado pelo bootstrap.
  patched = replaceRequired(
    patched,
    "activities = mockActivities.map(a => {",
    "activities = (Array.isArray(window.__ROTINAOS_DEMO_ACTIVITIES__) ? window.__ROTINAOS_DEMO_ACTIVITIES__ : mockActivities).map(a => {",
    'fonte de dados da demonstração'
  );

  // Firestore mantém as alterações em fila quando está offline. As Promises de
  // escrita podem permanecer pendentes até o servidor responder, então a UI não
  // deve ficar esperando essa confirmação quando navigator.onLine === false.
  patched = replaceRequired(
    patched,
    'await updateDoc(doc(db, "activities", id), data);',
    'await settleFirestoreWrite(updateDoc(doc(db, "activities", id), data));',
    'update offline não bloqueante'
  );

  patched = replaceRequired(
    patched,
    'await deleteDoc(doc(db, "activities", id));',
    'await settleFirestoreWrite(deleteDoc(doc(db, "activities", id)));',
    'delete offline não bloqueante'
  );

  patched = replaceRequired(
    patched,
    'await addDoc(collection(db, "activities"), data);',
    'await settleFirestoreWrite(addDoc(collection(db, "activities"), data));',
    'add offline não bloqueante'
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
  // A ativação é direta: não depende de fabricar um segundo clique no botão de login.
  patched += `\n\n// === RotinaOS runtime bridge (injetado por core-loader.js) ===\nfunction settleFirestoreWrite(operation) {\n  if (navigator.onLine) return operation;\n  Promise.resolve(operation).catch(error => {\n    console.warn('Uma alteração offline não pôde ser mantida na fila do Firestore:', error);\n  });\n  return Promise.resolve();\n}\n\nfunction publishDemoState() {\n  if (!isDemoMode) return;\n  const snapshot = activities.map(item => ({ ...item }));\n  window.__ROTINAOS_DEMO_ACTIVITIES__ = snapshot;\n  document.dispatchEvent(new CustomEvent('rotinaos:demo-activities', {\n    detail: { activities: snapshot.map(item => ({ ...item })) }\n  }));\n}\n\nfunction activateDemoFromBridge() {\n  if (!window.__ROTINAOS_DEMO__) return false;\n  if (isDemoMode) {\n    publishDemoState();\n    return true;\n  }\n\n  isDemoMode = true;\n  currentUser = { uid: 'demo-user', email: 'demo@todoos.app' };\n\n  const today = getTodayString();\n  const sourceActivities = Array.isArray(window.__ROTINAOS_DEMO_ACTIVITIES__)\n    ? window.__ROTINAOS_DEMO_ACTIVITIES__\n    : mockActivities;\n\n  activities = sourceActivities.map(activity => {\n    if (activity.scheduledTime && !activity.fixedDays) {\n      return { ...activity, scheduledDate: activity.scheduledDate || today };\n    }\n    return { ...activity };\n  });\n\n  authContainer?.classList.add('hidden');\n  appEl?.classList.remove('hidden');\n  refreshUI();\n  publishDemoState();\n  document.getElementById('modal-demo-notice')?.classList.remove('hidden');\n  window.setTimeout(() => scrollToCurrentTimeIndicator?.(), 120);\n  return true;\n}\n\nwindow.RotinaDemoCore = {\n  activate: activateDemoFromBridge,\n  isActive: () => isDemoMode,\n  getActivities: () => activities.map(item => ({ ...item })),\n  updateActivity: async (id, data) => {\n    if (!isDemoMode) return false;\n    await safeUpdate(id, data);\n    return true;\n  },\n  deleteActivity: async (id) => {\n    if (!isDemoMode) return false;\n    await safeDelete(id);\n    return true;\n  },\n  renameCategory: async (oldName, newName) => {\n    if (!isDemoMode) return 0;\n    const normalize = value => String(value || '').trim();\n    let changed = 0;\n    activities = activities.map(activity => {\n      const category = normalize(activity.category) || 'Sem categoria';\n      if (category !== oldName) return activity;\n      changed += 1;\n      return { ...activity, category: newName };\n    });\n    refreshUI();\n    publishDemoState();\n    return changed;\n  },\n  refresh: () => {\n    if (!isDemoMode) return;\n    refreshUI();\n    publishDemoState();\n  }\n};\n\nif (window.__ROTINAOS_DEMO__) {\n  activateDemoFromBridge();\n}\n`;

  return patched;
}

export async function loadCore() {
  // Sem cache:no-store: o Service Worker pode responder imediatamente com a cópia
  // local quando o aparelho estiver offline e atualizar em background quando online.
  const response = await fetch('./js/app-core.js');
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
