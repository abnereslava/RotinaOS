import test from 'node:test';
import assert from 'node:assert/strict';
import { todayKey, weekStart, emptyWeek, isExpired, reconcileTracked, setTracked, beginNewWeek } from '../js/weekly-checklist-model.js';

test('a semana usa segunda a domingo e a virada de São Paulo', () => {
  assert.equal(weekStart('2026-11-08'), '2026-11-02');
  assert.equal(weekStart('2026-11-09'), '2026-11-09');
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.equal(todayKey(new Date('2026-11-09T02:59:59Z')), '2026-11-08');
  assert.equal(todayKey(new Date('2026-11-09T03:00:00Z')), '2026-11-09');
  const state = emptyWeek('u', '2026-11-05');
  assert.equal(isExpired(state, '2026-11-08'), false);
  assert.equal(isExpired(state, '2026-11-09'), true);
});

test('renovar remove apenas os checados e mantém pendentes manuais e vinculados', () => {
  const state = { ...emptyWeek('u', '2026-11-05'), items: [
    { id: 'manual1', activityId: null, title: 'Manual pendente', done: false },
    { id: 'manual2', activityId: null, title: 'Manual feito', done: true },
    { id: 'task_a', activityId: 'a', title: 'Banco pendente', done: false },
    { id: 'task_b', activityId: 'b', title: 'Banco feito', done: true }
  ] };
  assert.equal(beginNewWeek(state, '2026-11-08'), state);
  const next = beginNewWeek(state, '2026-11-23');
  assert.deepEqual(next.items, [state.items[0], state.items[2]]);
  assert.equal(next.weekStart, '2026-11-23');
  assert.deepEqual(next.omittedActivityIds, ['b']);
  assert.equal(state.items.length, 4);
  assert.equal(beginNewWeek(next, '2026-11-23'), next);
});

test('um snapshot atrasado não reintroduz um item concluído após renovar', () => {
  const state = { ...emptyWeek('u', '2026-11-05'), items: [
    { id: 'task_a', activityId: 'a', title: 'Tarefa', done: true }
  ] };
  const activity = { id: 'a', title: 'Tarefa', isTracked: true };
  const next = beginNewWeek(state, '2026-11-09');
  assert.equal(reconcileTracked(next, [activity]).items.length, 0);
  assert.equal(setTracked(next, activity, true).items.length, 1);
});

test('tarefas com o mesmo título continuam independentes e sem duplicação', () => {
  const activities = ['a', 'b'].map(id => ({ id, title: 'Igual', isTracked: true }));
  const state = reconcileTracked(emptyWeek('u', '2026-11-05'), activities);
  assert.equal(state.items.length, 2);
  assert.notEqual(state.items[0].id, state.items[1].id);
  assert.equal(reconcileTracked(state, activities), state);
  state.items[0].done = true;
  assert.equal(setTracked(state, activities[0], true).items.find(item => item.activityId === 'a').done, true);
  const removed = setTracked(state, activities[0], false);
  assert.deepEqual(removed.items.map(item => item.activityId), ['b']);
  assert.equal(reconcileTracked(removed, activities).items.length, 1);
});
