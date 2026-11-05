import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const source = await readFile(new URL('../js/main-swipe.js', import.meta.url), 'utf8');

function fixture() {
  const { window, document } = parseHTML(`<!doctype html><html><body>
    <main id="app"></main>
    <section id="weekly-checklist-view">
      <input id="weekly-new-item"><select id="weekly-sort"><option>Nome</option></select>
      <table><tbody id="weekly-items">
        <tr><td><input id="check" type="checkbox" data-weekly-id="task_a"></td>
          <td><button id="title"><span id="title-text">Tarefa</span></button></td>
          <td><button id="remove">Remover</button></td></tr>
        <tr><td><input type="checkbox" data-weekly-id="manual_a"></td>
          <td><span id="manual-text">Manual</span></td></tr>
      </tbody></table>
    </section>
    <section id="calendar-view" class="hidden"></section>
    <section id="modal-full-view" class="modal hidden"></section>
    <div id="modal-detail-overlay" class="modal hidden"></div>
  </body></html>`);
  let now = 0;
  const timers = [];
  Object.assign(window, {
    innerWidth: 390, matchMedia: () => ({ matches: false }),
    setTimeout: (fn, delay) => timers.push({ fn, due: now + delay })
  });
  vm.runInNewContext(source, {
    window, document, innerWidth: 390, performance: { now: () => now }, CustomEvent: window.CustomEvent
  });
  const visible = id => !document.getElementById(id).classList.contains('hidden');
  const tick = () => {
    now += 400;
    const pending = timers.splice(0);
    for (const timer of pending) {
      if (timer.due <= now) timer.fn(); else timers.push(timer);
    }
  };
  function send(target, type, x, y) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    const points = [{ clientX: x, clientY: y }];
    Object.defineProperty(event, type === 'touchend' ? 'changedTouches' : 'touches', { value: points });
    target.dispatchEvent(event);
    return event;
  }
  function swipe(id, dx, { dy = 0, cancel = false } = {}) {
    const target = document.getElementById(id);
    send(target, 'touchstart', 180, 300);
    const move = send(target, 'touchmove', 180 + dx, 300 + dy);
    send(target, cancel ? 'touchcancel' : 'touchend', 180 + dx, 300 + dy);
    tick();
    return move;
  }
  function click(id) {
    const event = new window.Event('click', { bubbles: true, cancelable: true });
    document.getElementById(id).dispatchEvent(event);
    return event;
  }
  function tap(id) {
    const target = document.getElementById(id);
    send(target, 'touchstart', 180, 300);
    send(target, 'touchend', 180, 300);
    return click(id);
  }
  return { document, visible, swipe, click, tap };
}

test('swipe sobre título, checkbox, remoção e texto manual navega sem emitir a ação de toque', () => {
  for (const target of ['title-text', 'check', 'remove', 'manual-text']) {
    for (const direction of [-140, 140]) {
      const app = fixture();
      let actions = 0;
      app.document.addEventListener('click', () => { actions++; });
      const move = app.swipe(target, direction);
      assert.equal(move.defaultPrevented, true, target);
      assert.equal(app.visible('calendar-view'), direction > 0, target);
      assert.equal(app.visible('weekly-checklist-view'), direction > 0, target);
      assert.equal(app.click(target).defaultPrevented, true, 'bloqueia o click residual do arraste');
      assert.equal(actions, 0, 'não abre modal, marca ou remove ao navegar');
    }
  }
});

test('toque simples continua disponível depois de gesto cancelado; edição, seleção e modais não navegam', () => {
  for (const target of ['title-text', 'check', 'remove']) {
    const app = fixture();
    app.swipe(target, 140, { cancel: true });
    assert.equal(app.visible('calendar-view'), false);
    assert.equal(app.visible('weekly-checklist-view'), true);
    assert.equal(app.tap(target).defaultPrevented, false, 'novo toque real não herda o bloqueio');
  }
  for (const target of ['weekly-new-item', 'weekly-sort']) {
    const app = fixture();
    app.swipe(target, 140);
    assert.equal(app.visible('calendar-view'), false, 'controles de edição não iniciam swipe');
  }
  const app = fixture();
  app.swipe('title-text', 10, { dy: 160 });
  assert.equal(app.visible('calendar-view'), false, 'rolagem vertical preservada');
  assert.equal(app.tap('title-text').defaultPrevented, false);
  app.document.getElementById('modal-detail-overlay').classList.remove('hidden');
  app.swipe('title-text', 140);
  assert.equal(app.visible('calendar-view'), false, 'modal aberto bloqueia navegação ao fundo');
});
