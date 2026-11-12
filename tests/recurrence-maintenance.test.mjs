import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Exercita a função usada pelo núcleo sem inicializar Firebase ou a interface.
const source = readFileSync(new URL('../js/app-core.js', import.meta.url), 'utf8');
const start = source.indexOf('async function runDailyMaintenance(');
const end = source.indexOf('\nfunction populateCategories(', start);
assert.ok(start >= 0 && end > start, 'a manutenção diária deve existir no núcleo');
const maintenanceSource = source.slice(start, end);

async function maintenanceOn(date, activity) {
  const updates = [];
  const run = new Function('todayString', 'safeUpdate', 'safeDelete',
    `${maintenanceSource}; return runDailyMaintenance;`)(
    date,
    async (id, data) => updates.push({ id, data }),
    async () => {}
  );
  await run([activity]);
  return updates;
}

test('uma rotina de segunda a sexta volta a ficar pendente no dia seguinte', async () => {
  const activity = {
    id: 'rotina', recurrence: 'weekly', fixedDays: [1, 2, 3, 4, 5],
    status: 'completed', completionDate: '2026-11-11',
    useChecklist: true, checklist: [{ text: 'Etapa', done: true }]
  };
  assert.deepEqual(await maintenanceOn('2026-11-12', activity), [{
    id: 'rotina',
    data: {
      status: 'pending', completionDate: null,
      checklist: [{ text: 'Etapa', done: false }]
    }
  }]);
  assert.deepEqual(await maintenanceOn('2026-11-11', activity), []);
  assert.deepEqual(await maintenanceOn('2026-11-14', activity), []);
});

test('uma tarefa de um dia fixo volta apenas na próxima ocorrência', async () => {
  const activity = {
    id: 'semanal', recurrence: 'weekly', fixedDays: [3],
    status: 'completed', completionDate: '2026-11-11'
  };
  assert.deepEqual(await maintenanceOn('2026-11-12', activity), []);
  assert.deepEqual(await maintenanceOn('2026-11-18', activity), [{
    id: 'semanal', data: { status: 'pending', completionDate: null }
  }]);
});
