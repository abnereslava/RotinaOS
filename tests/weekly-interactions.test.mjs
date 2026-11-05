import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import * as model from '../js/weekly-checklist-model.js';

const read = name => readFile(new URL(`../js/${name}`, import.meta.url), 'utf8');
const withoutImports = source => source.replace(/^import[\s\S]*?;\s*$/gm, '');
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

async function setup({ demo = false, saved = null, tasks = [] } = {}) {
  const { window, document } = parseHTML(`<!doctype html><html><body>
    <main id="app"><button id="btn-weekly-checklist"></button></main>
    <div id="modal-full-view" class="modal hidden"><div id="full-view-container" class="full-view-columns"></div></div>
    <button id="btn-full-view"></button><button id="btn-close-full-view"></button>
    <section id="calendar-view" class="hidden"></section></body></html>`);
  let day = '2026-11-05';
  let now = 0;
  const timers = new Map();
  let timerId = 0;
  const schedule = (fn, delay = 0) => { timers.set(++timerId, { fn, time: now + delay }); return timerId; };
  const storage = new Map(saved ? [['rotinaos.weekly.demo.v1', JSON.stringify(saved)]] : []);
  const data = new Map(tasks.map(task => [`activities/${task.id}`, { ...task, userId: 'u' }]));
  if (!demo && saved) data.set('weekly_checklists/u', { ...saved, userId: 'u' });
  const listeners = new Set();
  const intervals = [];
  const errors = [];
  const snapshot = ref => ({ id: ref.id, ref, exists: () => data.has(ref.path), data: () => structuredClone(data.get(ref.path)) });
  const notify = () => listeners.forEach(listener => queueMicrotask(listener));
  const environment = {
    ...model,
    todayKey: () => day,
    isExpired: (state, key = day) => model.isExpired(state, key),
    emptyWeek: (uid, key = day) => model.emptyWeek(uid, key),
    beginNewWeek: (state, key = day) => model.beginNewWeek(state, key),
    innerWidth: 390, window, document, CustomEvent: window.CustomEvent, MutationObserver: window.MutationObserver,
    navigator: { onLine: true, vibrate: () => {}, maxTouchPoints: 1 },
    performance: { now: () => now },
    crypto: globalThis.crypto,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    console: { error: (...args) => errors.push(args) },
    setInterval: fn => intervals.push(fn), clearTimeout: id => timers.delete(id), setTimeout: schedule,
    requestAnimationFrame: fn => queueMicrotask(fn),
    getApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
    onAuthStateChanged: (_, fn) => { queueMicrotask(() => fn(demo ? null : { uid: 'u' })); },
    doc: (_, collection, id) => ({ path: `${collection}/${id}`, id }),
    collection: (_, name) => ({ name }), where: () => ({}), query: source => source,
    onSnapshot: (ref, callback) => {
      const listener = () => callback(ref.path ? snapshot(ref) : { docs: [...data.keys()]
        .filter(path => path.startsWith(`${ref.name}/`)).map(path => snapshot({ path, id: path.split('/')[1] })) });
      listeners.add(listener); queueMicrotask(listener);
      return () => listeners.delete(listener);
    },
    runTransaction: async (_, callback) => {
      const writes = [];
      const result = await callback({
        get: async ref => {
          assert.equal(writes.length, 0, 'leituras devem vir antes das escritas');
          if (ref.path.startsWith('activities/') && !data.has(ref.path)) {
            throw Object.assign(new Error('Atividade inexistente: leitura negada pelas regras.'), { code: 'permission-denied' });
          }
          return snapshot(ref);
        },
        set: (ref, value) => writes.push(() => data.set(ref.path, structuredClone(value))),
        update: (ref, patch) => writes.push(() => data.set(ref.path, { ...data.get(ref.path), ...structuredClone(patch) }))
      });
      writes.forEach(write => write());
      if (writes.length) notify();
      return result;
    }
  };
  Object.assign(window, {
    __ROTINAOS_DEMO__: demo,
    __ROTINAOS_DEMO_ACTIVITIES__: tasks,
    innerWidth: 390,
    matchMedia: () => ({ matches: false }),
    setTimeout: schedule, clearTimeout: environment.clearTimeout,
    RotinaDemoCore: {
      updateActivity: async (id, patch) => {
        const task = tasks.find(item => item.id === id);
        if (!task) return false;
        Object.assign(task, patch);
        document.dispatchEvent(new window.CustomEvent('rotinaos:demo-activities', { detail: { activities: tasks } }));
        return true;
      }
    }
  });
  const context = vm.createContext(environment);
  vm.runInContext(`(() => { ${withoutImports(await read('weekly-checklist.js'))} })()`, context);
  const dialog = document.getElementById('weekly-confirm');
  dialog.showModal = () => { dialog.open = true; dialog.setAttribute('open', ''); };
  dialog.close = value => {
    dialog.returnValue = value; dialog.open = false; dialog.removeAttribute('open');
    dialog.dispatchEvent(new window.Event('close'));
  };
  const tick = async (elapsed = 1000) => {
    now += elapsed;
    for (const [id, timer] of [...timers]) if (timer.time <= now) { timers.delete(id); timer.fn(); }
    await flush();
  };
  document.getElementById('btn-full-view').onclick = () => document.getElementById('modal-full-view').classList.remove('hidden');
  document.getElementById('btn-close-full-view').onclick = () => document.getElementById('modal-full-view').classList.add('hidden');
  document.getElementById('full-view-container').scrollLeft = 0;
  await flush();
  return {
    window, document, context, data, errors, dialog, tasks,
    removeTask: async id => { data.delete(`activities/${id}`); notify(); await flush(); },
    state: () => demo ? JSON.parse(storage.get('rotinaos.weekly.demo.v1')) : structuredClone(data.get('weekly_checklists/u')),
    rows: () => [...document.querySelectorAll('#weekly-items input[data-weekly-id]')],
    tick,
    changeDay: async key => { day = key; intervals.forEach(fn => fn()); await flush(); },
    submit: async title => {
      document.getElementById('weekly-new-item').value = title;
      document.getElementById('weekly-add-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    },
    check: async (id, done) => {
      const input = [...document.querySelectorAll('[data-weekly-id]')].find(input => input.dataset.weeklyId === id);
      input.checked = done;
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
      await flush();
    },
    load: async name => vm.runInContext(`(() => { ${withoutImports(await read(name))} })()`, context)
  };
}

for (const demo of [true, false]) {
  test(`${demo ? 'demo' : 'Firestore simulado'}: cadastro manual, confirmação e renovação`, async () => {
    const tasks = [
      { id: 'a', title: 'Mesmo nome', status: 'pending', isTracked: true },
      { id: 'b', title: 'Mesmo nome', status: 'pending', isTracked: false, useChecklist: true, checklist: [{ text: 'Parte', done: false }] }
    ];
    const app = await setup({ demo, tasks });
    assert.equal(app.state().items.length, 1, 'importa destaques existentes');
    await app.submit('Manual <seguro>');
    assert.equal(app.state().items.length, 2);
    assert.match(app.document.getElementById('weekly-items').textContent, /Manual <seguro>/);
    assert.equal(app.document.querySelector('#weekly-items seguro'), null);
    const manual = app.state().items.find(item => !item.activityId);
    await app.check(manual.id, true);
    assert.equal(Boolean(app.dialog.open), false, 'item manual não pergunta sobre banco');
    await app.check('task_a', true);
    assert.equal(app.dialog.open, true);
    app.dialog.close('no'); await flush();
    const taskA = () => demo ? tasks[0] : app.data.get('activities/a');
    assert.equal(taskA().status, 'pending', 'recusar preserva tarefa no banco');
    assert.equal(app.state().items.find(item => item.activityId === 'a').done, true);
    await app.window.RotinaWeeklyChecklist.setTrackedActivity(tasks[1], true); await flush();
    await app.check('task_b', true);
    app.dialog.close('yes'); await flush();
    const taskB = demo ? tasks[1] : app.data.get('activities/b');
    assert.equal(taskB.status, 'completed');
    assert.equal(taskB.completionDate, '2026-11-05');
    assert.equal(taskB.checklist[0].done, true);
    await app.check('task_b', false);
    assert.equal((demo ? tasks[1] : app.data.get('activities/b')).status, 'completed', 'desmarcar só afeta semana');
    await app.changeDay('2026-11-09');
    assert.equal(app.document.getElementById('weekly-table-wrap').classList.contains('is-expired'), true);
    assert.ok(app.rows().every(input => input.disabled));
    app.document.getElementById('weekly-new-week').click(); await flush();
    assert.deepEqual(app.state().items.map(item => item.activityId), ['b']);
    assert.equal(taskA().status, 'pending', 'renovar não exclui tarefa original');
    assert.equal(taskA().isTracked, false);
    assert.equal(app.state().weekStart, '2026-11-09');
    assert.equal(app.errors.length, 0);
  });
}

test('remover um vínculo não exclui a tarefa, e remoção externa mantém o item semanal', async () => {
  const tasks = [{ id: 'a', title: 'Banco', status: 'pending', isTracked: true }];
  const app = await setup({ demo: true, tasks });
  app.document.querySelector('[data-remove-weekly="task_a"]').click(); await flush();
  assert.equal(app.state().items.length, 0);
  assert.equal(tasks[0].isTracked, false);
  assert.equal(tasks[0].status, 'pending');
  await app.window.RotinaWeeklyChecklist.setTrackedActivity(tasks[0], true); await flush();
  app.document.dispatchEvent(new app.window.CustomEvent('rotinaos:demo-activities', { detail: { activities: [] } }));
  await flush();
  assert.equal(app.state().items.length, 1);
  await app.check('task_a', true);
  assert.equal(Boolean(app.dialog.open), false);
});

test('gestos passam por Hoje → checklist → calendário e voltam sem pular telas', async () => {
  const app = await setup({ demo: true });
  await app.load('main-swipe.js');
  const { document, window } = app;
  const shown = id => !document.getElementById(id).classList.contains('hidden');
  async function swipe(targetId, dx, { cancel = false, dy = 0 } = {}) {
    const target = document.getElementById(targetId);
    const send = (type, x, y) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      const points = [{ clientX: x, clientY: y }];
      Object.defineProperty(event, type === 'touchend' ? 'changedTouches' : 'touches', { value: points });
      target.dispatchEvent(event);
    };
    send('touchstart', 180, 300);
    send('touchmove', 180 + dx, 300 + dy);
    send(cancel ? 'touchcancel' : 'touchend', 180 + dx, 300 + dy);
    await app.tick();
  }
  await swipe('app', 140);
  assert.equal(shown('weekly-checklist-view'), true);
  assert.equal(shown('calendar-view'), false);
  await swipe('weekly-checklist-view', 140);
  assert.equal(shown('calendar-view'), true);
  await swipe('calendar-view', -140);
  assert.equal(shown('calendar-view'), false);
  assert.equal(shown('weekly-checklist-view'), true);
  await swipe('weekly-checklist-view', -140);
  assert.equal(shown('weekly-checklist-view'), false);
  await swipe('app', -140);
  assert.equal(shown('modal-full-view'), true);
  await swipe('modal-full-view', 140);
  assert.equal(shown('modal-full-view'), false);
  await swipe('app', 40);
  assert.equal(shown('weekly-checklist-view'), false, 'gesto curto reverte a prévia');
  await swipe('app', 140, { cancel: true });
  assert.equal(shown('weekly-checklist-view'), false, 'cancelar reverte a prévia');
  await swipe('app', 140, { dy: 300 });
  assert.equal(shown('weekly-checklist-view'), false, 'rolagem vertical não abre tela');
  window.RotinaSwipeNavigation.openWeekly(); await app.tick();
  assert.equal(document.getElementById('weekly-go-calendar'), null);
  assert.equal(document.getElementById('weekly-go-home'), null);
  await swipe('weekly-checklist-view', 140);
  assert.equal(shown('calendar-view'), true);
  document.dispatchEvent(new window.CustomEvent('rotinaos:calendar-close-request')); await app.tick();
  assert.equal(shown('weekly-checklist-view'), true);
});

test('toque longo usa o ID de cada tarefa mesmo com títulos iguais e cancela no arraste', async () => {
  const tasks = ['a', 'b'].map(id => ({ id, title: 'Igual', category: 'Casa', isTracked: false }));
  const app = await setup({ demo: true, tasks });
  const container = app.document.getElementById('full-view-container');
  container.innerHTML = tasks.map(task => `<div class="pending-item" data-activity-id="${task.id}"><h3>Igual</h3></div>`).join('');
  await app.load('activity-tracking.js'); await flush();
  const card = id => app.document.querySelector(`[data-activity-id="${id}"]`);
  const pointer = (target, type, x = 20) => {
    const event = new app.window.Event(type, { bubbles: true });
    Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: 20 });
    target.dispatchEvent(event);
  };
  pointer(card('b'), 'pointerdown'); await app.tick(550); pointer(card('b'), 'pointerup'); await flush();
  assert.deepEqual(app.state().items.map(item => item.activityId), ['b']);
  assert.equal(tasks[0].isTracked, false);
  assert.equal(tasks[1].isTracked, true);
  pointer(card('a'), 'pointerdown'); pointer(card('a'), 'pointermove', 60); await app.tick(550);
  assert.deepEqual(app.state().items.map(item => item.activityId), ['b']);
  assert.equal(app.errors.length, 0);
});

test('regras atuais: renovar ou remover não lê tarefas já excluídas do banco', async () => {
  const tasks = ['a', 'b'].map(id => ({ id, title: id, status: 'pending', isTracked: true }));
  const app = await setup({ tasks });
  await app.check('task_a', true);
  app.dialog.close('no'); await flush();
  await app.removeTask('a');
  await app.removeTask('b');
  app.document.querySelector('[data-remove-weekly="task_b"]').click(); await flush();
  assert.deepEqual(app.state().items.map(item => item.activityId), ['a']);
  await app.changeDay('2026-11-09');
  app.document.getElementById('weekly-new-week').click(); await flush();
  assert.equal(app.state().items.length, 0);
  assert.equal(app.state().weekStart, '2026-11-09');
  assert.equal(app.errors.length, 0);
});

test('ícones de origem e toque no título reutilizam o modal original pelo ID', async () => {
  const tasks = [
    { id: 'a', title: 'Mesmo nome', details: 'Detalhes da tarefa A', category: 'Casa', priority: '1', recurrence: 'single', status: 'pending', isTracked: true },
    { id: 'b', title: 'Mesmo nome', details: 'Detalhes da tarefa B', category: 'Trabalho', priority: '3', recurrence: 'single', status: 'pending', isTracked: true }
  ];
  const app = await setup({ demo: true, tasks });
  const coreSource = await read('app-core.js');
  const detailSource = coreSource.slice(coreSource.indexOf('function showDetailModal('), coreSource.indexOf('function wasCompletedThisWeek('));
  // Executa o modal e sua API reais, com a mesma coleção usada pela checklist.
  app.context.fixtureTasks = tasks;
  vm.runInContext(`(() => {
    const activities = fixtureTasks;
    let todayString = '2026-11-05';
    const getTodayString = () => '2026-11-05';
    const isActivityActiveToday = () => false;
    ${detailSource}
  })()`, app.context);
  await app.submit('Item manual');
  const manual = app.state().items.find(item => !item.activityId);
  assert.equal(app.document.querySelectorAll('[data-weekly-origin="bank"]').length, 2);
  assert.equal(app.document.querySelectorAll('[data-weekly-origin="manual"]').length, 1);
  assert.match(app.document.querySelector('[data-weekly-origin="bank"]').getAttribute('aria-label'), /Banco/);
  assert.match(app.document.querySelector('[data-weekly-origin="manual"]').getAttribute('aria-label'), /manual/);
  assert.ok(app.document.querySelector('[data-weekly-origin="bank"]').closest('.weekly-item-meta'));
  assert.ok(app.document.querySelector('[data-weekly-origin="manual"]').closest('.weekly-item-meta'));
  assert.equal(app.document.querySelector(`[data-open-weekly="${manual.id}"]`), null);
  assert.match(app.document.querySelector('[data-open-weekly="task_b"]').closest('td').textContent, /Trabalho/);
  app.document.getElementById('weekly-checklist-view').classList.remove('hidden');
  app.document.querySelector('[data-open-weekly="task_b"]').click();
  let detail = app.document.getElementById('modal-detail-overlay');
  assert.ok(detail);
  assert.match(detail.textContent, /Detalhes da tarefa B/);
  assert.doesNotMatch(detail.textContent, /Detalhes da tarefa A/);
  assert.ok(detail.querySelector('#detail-btn-edit'));
  assert.ok(detail.querySelector('#detail-btn-full'));
  assert.equal(app.state().items.find(item => item.activityId === 'b').done, false);
  detail.querySelector('#btn-close-detail').click();
  assert.equal(app.document.getElementById('modal-detail-overlay'), null);
  assert.equal(app.document.getElementById('weekly-checklist-view').classList.contains('hidden'), false);
  await app.check('task_b', true);
  assert.equal(app.document.getElementById('modal-detail-overlay'), null, 'checkbox mantém sua ação de conclusão');
  app.dialog.close('no'); await flush();
  app.document.dispatchEvent(new app.window.CustomEvent('rotinaos:demo-activities', { detail: { activities: [tasks[0]] } }));
  await flush();
  assert.equal(app.document.querySelector('[data-open-weekly="task_b"]'), null);
  assert.match(app.document.getElementById('weekly-items').textContent, /Tarefa removida do banco/);
});

test('ordenar muda só a apresentação e mantém os checks vinculados aos IDs', async () => {
  const tasks = [
    { id: 'a', title: 'Zelar', category: 'Casa', priority: '1', isTracked: true },
    { id: 'b', title: 'Anotar', category: 'Trabalho', priority: '3', isTracked: true }
  ];
  const app = await setup({ demo: true, tasks });
  const control = app.document.getElementById('weekly-sort');
  for (const option of control.querySelectorAll('option')) option.removeAttribute('selected');
  control.querySelector('[value="priority-desc"]').setAttribute('selected', '');
  control.dispatchEvent(new app.window.Event('change'));
  assert.deepEqual(app.rows().map(input => input.dataset.weeklyId), ['task_b', 'task_a']);
  assert.deepEqual(app.state().items.map(item => item.activityId), ['a', 'b']);
  await app.check('task_b', true);
  app.dialog.close('no'); await flush();
  for (const option of control.querySelectorAll('option')) option.removeAttribute('selected');
  control.querySelector('[value="name-desc"]').setAttribute('selected', '');
  control.dispatchEvent(new app.window.Event('change'));
  assert.deepEqual(app.rows().map(input => input.dataset.weeklyId), ['task_a', 'task_b']);
  assert.equal(app.state().items.find(item => item.activityId === 'b').done, true);
  assert.equal(app.document.querySelector('#weekly-go-home'), null);
  assert.equal(app.document.querySelector('#weekly-go-calendar'), null);
});

test('conclusão pela checklist segue a conclusão geral e permanece no banco durante o dia', async () => {
  const tasks = ['single', 'daily', 'weekly', 'monthly'].map((recurrence, index) => ({
    id: `activity_${index}`, title: `Tarefa ${recurrence}`, category: 'Teste', priority: '2',
    recurrence, status: 'pending', isTracked: true, useChecklist: true,
    checklist: [{ text: 'Etapa', done: false }]
  }));
  tasks.push({ id: 'general', title: 'Conclusão geral', category: 'Teste', priority: '2', recurrence: 'single',
    status: 'pending', useChecklist: true, checklist: [{ text: 'Etapa', done: false }] });
  const app = await setup({ demo: true, tasks });
  const core = await read('app-core.js');
  const maintenance = core.slice(core.indexOf('async function runDailyMaintenance('), core.indexOf('function populateCategories('));
  const detail = core.slice(core.indexOf('function showDetailModal('), core.indexOf('function wasCompletedThisWeek('));
  const card = core.slice(core.indexOf('function createActivityCard('), core.indexOf('function renderPendingList('));
  const bank = core.slice(core.indexOf('function renderFullView('), core.indexOf('// Listeners para os controles da Visão Geral'));
  const controls = app.document.createElement('div');
  controls.innerHTML = '<input id="full-view-search"><select id="full-view-sort"><option value="none" selected>Inclusão</option></select>';
  app.document.body.appendChild(controls);
  app.context.fixtureTasks = tasks;
  vm.runInContext(`(() => {
    let activities = fixtureTasks;
    let todayString = '2026-11-05';
    const getTodayString = () => todayString;
    const isActivityActiveToday = () => false;
    const fullViewContainer = document.getElementById('full-view-container');
    const fullViewHideScheduled = false;
    const collapsedCategories = new Set();
    const deleted = [];
    const safeUpdate = async (id, data) => Object.assign(activities.find(item => item.id === id), data);
    const safeDelete = async id => { deleted.push(id); };
    ${maintenance}
    ${detail}
    ${card}
    ${bank}
    window.CompletionFixture = {
      completeGenerally: () => {
        showDetailModal(activities.find(item => item.id === 'general'));
        document.getElementById('detail-btn-full').click();
      },
      maintain: async key => {
        todayString = key;
        await runDailyMaintenance(activities);
        activities = activities.filter(item => !deleted.includes(item.id));
      },
      renderBank: renderFullView,
      getActivities: () => activities,
      deleted
    };
  })()`, app.context);
  for (let index = 0; index < 4; index++) {
    await app.check(`task_activity_${index}`, true);
    app.dialog.close('yes');
    await flush();
  }
  app.window.CompletionFixture.completeGenerally();
  await flush();
  const general = tasks.find(item => item.id === 'general');
  for (const task of tasks) {
    assert.equal(task.status, general.status);
    assert.equal(task.completionDate, general.completionDate);
    assert.equal(task.checklist[0].done, true);
  }
  await app.window.CompletionFixture.maintain('2026-11-05');
  app.window.CompletionFixture.renderBank();
  assert.equal(app.window.CompletionFixture.deleted.length, 0, 'concluir não exclui imediatamente');
  assert.equal(app.document.querySelectorAll('#full-view-container .pending-item').length, 5);
  assert.equal(app.document.querySelectorAll('#full-view-container .completed-today').length, 5);
  await app.window.CompletionFixture.maintain('2026-11-06');
  assert.deepEqual(Array.from(app.window.CompletionFixture.deleted).sort(), ['activity_0', 'general']);
  const recurring = app.window.CompletionFixture.getActivities();
  assert.equal(recurring.length, 3);
  assert.equal(recurring.find(item => item.recurrence === 'daily').status, 'pending');
  assert.equal(recurring.find(item => item.recurrence === 'weekly').status, 'completed');
  assert.equal(recurring.find(item => item.recurrence === 'monthly').status, 'completed');
});
