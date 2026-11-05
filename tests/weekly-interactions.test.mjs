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
  document.getElementById('weekly-go-calendar').click(); await app.tick();
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
