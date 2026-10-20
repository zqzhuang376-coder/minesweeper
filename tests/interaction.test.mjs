import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Minesweeper } from '../dist/engine.js';

const source = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');

// A small DOM and virtual clock execute the real application's event handlers.
// These tests cover input sequencing; browser tests still cover rendering and
// platform-generated touch/context-menu event behavior.
function app() {
  let now = 0, nextTimer = 0;
  const timers = new Map(), elements = new Map(), saved = new Map();
  class Element {
    children = [];
    handlers = {};
    dataset = {};
    attributes = {};
    style = { setProperty() {}, removeProperty() {} };
    classList = { toggle() {} };
    innerHTML = '';
    textContent = '';
    tabIndex = -1;
    open = false;
    addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(child) { this.children.push(child); }
    replaceChildren(fragment) { this.children = [...fragment.children]; }
    closest(selector) {
      return selector === '[data-index]' && 'index' in this.dataset ? this : null;
    }
    focus() { document.activeElement = this; }
    close() { this.open = false; }
    showModal() { this.open = true; }
  }
  const document = {
    activeElement: null,
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    },
    querySelectorAll(selector) {
      if (selector === 'dialog[open]') return [...elements.values()].filter(el => el.open);
      return [];
    },
    createDocumentFragment() { return new Element(); },
    createElement() { return new Element(); },
    addEventListener() {},
  };
  const schedule = (fn, delay, interval = false) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: now + delay, delay, interval });
    return id;
  };
  class DeterministicMinesweeper extends Minesweeper {
    constructor(rows, cols, mines) {
      let seed = 17;
      super(rows, cols, mines, () => {
        seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
        return seed / 4294967296;
      });
    }
  }
  const context = vm.createContext({
    Minesweeper: DeterministicMinesweeper,
    document,
    window: {},
    localStorage: {
      getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
    performance: { now: () => now },
    setTimeout: (fn, delay) => schedule(fn, delay),
    clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearInterval: id => timers.delete(id),
  });
  assert.match(source, /^import \{ Minesweeper \} from '.\/engine\.js';/);
  vm.runInContext(source.replace(/^import .*\n/, ''), context);
  const get = selector => document.querySelector(selector);
  const read = expression => vm.runInContext(expression, context);
  const fire = (selector, name, event = {}) => {
    for (const handler of get(selector).handlers[name] ?? []) {
      handler({ preventDefault() {}, target: get(selector), ...event });
    }
  };
  const boardEvent = (name, index, event = {}) => {
    fire('#board', name, { target: get('#board').children[index], ...event });
  };
  const advance = milliseconds => {
    const until = now + milliseconds;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.at;
      if (timer.interval) timer.at += timer.delay;
      else timers.delete(id);
      timer.fn();
    }
    now = until;
  };
  return { get, read, fire, boardEvent, advance, document, saved };
}

test('arrow keys preserve the current cell at every board edge', () => {
  const ui = app();
  for (const [index, key, expected] of [
    [4, 'ArrowUp', 4], [76, 'ArrowDown', 76],
    [18, 'ArrowLeft', 18], [26, 'ArrowRight', 26],
    [40, 'ArrowUp', 31], [40, 'ArrowDown', 49],
    [40, 'ArrowLeft', 39], [40, 'ArrowRight', 41],
    [40, 'Home', 36], [40, 'End', 44],
  ]) {
    ui.boardEvent('keydown', index, { key });
    assert.equal(Number(ui.document.activeElement.dataset.index), expected, `${index}: ${key}`);
    assert.equal(ui.get('#board').children.filter(cell => cell.tabIndex === 0).length, 1);
  }
});

test('a 1.8-second long press in flag mode inserts one flag on release', () => {
  const ui = app();
  ui.fire('#flag-mode', 'click');
  ui.boardEvent('pointerdown', 4, { pointerType: 'touch', clientX: 50, clientY: 50 });
  ui.advance(450);
  assert.equal(ui.read('game.cells[4].flagged'), true);
  ui.advance(1350);
  ui.boardEvent('pointerup', 4, { pointerType: 'touch' });
  ui.boardEvent('click', 4);
  assert.equal(ui.read('game.cells[4].flagged'), true);
  assert.equal(ui.read('game.flaggedCount'), 1);
  assert.equal(ui.read('game.status'), 'ready');

  // A subsequent, independent touch should still respond immediately.
  ui.boardEvent('pointerdown', 5, { pointerType: 'touch', clientX: 95, clientY: 50 });
  ui.boardEvent('pointerup', 5, { pointerType: 'touch' });
  ui.boardEvent('click', 5);
  assert.equal(ui.read('game.cells[5].flagged'), true);
});

test('long-pressing an existing flag removes it without revealing on release', () => {
  const ui = app();
  ui.boardEvent('contextmenu', 4, { pointerType: 'mouse' });
  ui.boardEvent('pointerdown', 4, { pointerType: 'touch', clientX: 50, clientY: 50 });
  ui.advance(1800);
  ui.boardEvent('pointerup', 4, { pointerType: 'touch' });
  ui.boardEvent('click', 4);
  assert.equal(ui.read('game.cells[4].flagged'), false);
  assert.equal(ui.read('game.cells[4].revealed'), false);
  assert.equal(ui.read('game.status'), 'ready');
});

test('rapid consecutive mouse right-clicks mark different cells without throttling', () => {
  const ui = app();
  ui.boardEvent('contextmenu', 4, { pointerType: 'mouse' });
  ui.advance(50);
  ui.boardEvent('contextmenu', 5, { pointerType: 'mouse' });
  assert.equal(ui.read('game.flaggedCount'), 2);
  assert.equal(ui.read('game.cells[4].flagged && game.cells[5].flagged'), true);
  ui.boardEvent('contextmenu', 4, { pointerType: 'mouse' });
  assert.equal(ui.read('game.flaggedCount'), 1);
  assert.equal(ui.read('game.cells[4].flagged'), false);
});

test('a touch context menu does not toggle a long-press flag a second time', () => {
  const ui = app();
  ui.boardEvent('pointerdown', 4, { pointerType: 'touch', clientX: 50, clientY: 50 });
  ui.advance(500);
  ui.boardEvent('contextmenu', 4, { pointerType: 'touch' });
  ui.boardEvent('pointerup', 4, { pointerType: 'touch' });
  ui.boardEvent('click', 4);
  assert.equal(ui.read('game.flaggedCount'), 1);
  assert.equal(ui.read('game.cells[4].flagged'), true);
});

test('moving or cancelling a touch before the threshold cancels the long press', () => {
  for (const event of ['pointermove', 'pointercancel']) {
    const ui = app();
    ui.boardEvent('pointerdown', 4, { pointerType: 'touch', clientX: 50, clientY: 50 });
    ui.advance(200);
    ui.boardEvent(event, 4, { pointerType: 'touch', clientX: 70, clientY: 50 });
    ui.advance(1000);
    assert.equal(ui.read('game.flaggedCount'), 0, event);
    assert.equal(ui.read('game.status'), 'ready', event);
  }
});

test('flags do not start the timer; a valid opening starts it and loss freezes it', () => {
  const ui = app();
  ui.advance(5000);
  ui.boardEvent('keydown', 4, { key: 'f' });
  ui.advance(3000);
  ui.boardEvent('click', 4);
  assert.equal(ui.get('#timer').textContent, '000');
  assert.equal(ui.read('game.status'), 'ready');

  ui.boardEvent('keydown', 40, { key: 'Enter' });
  assert.equal(ui.read('game.status'), 'playing');
  assert.equal(ui.read('game.cells[40].adjacent'), 0);
  ui.advance(2250);
  assert.equal(ui.get('#timer').textContent, '002');
  const mine = ui.read('game.cells.findIndex(cell => cell.mine && !cell.flagged)');
  ui.boardEvent('click', mine);
  assert.equal(ui.read('game.status'), 'lost');
  assert.equal(ui.get('#timer').textContent, '002');
  ui.advance(5000);
  assert.equal(ui.get('#timer').textContent, '002');
  assert.equal(ui.get('#result-dialog').open, true);
  assert.equal(ui.get('#result-time').innerHTML, '2<span> 秒</span>');
});

test('a win records elapsed seconds and restart cancels the pending result dialog', () => {
  const ui = app();
  ui.advance(5000);
  ui.boardEvent('click', 40);
  ui.advance(3250);
  for (let index = 0; index < 81; index += 1) {
    if (ui.read(`!game.cells[${index}].mine && !game.cells[${index}].revealed`)) {
      ui.boardEvent('click', index);
    }
  }
  assert.equal(ui.read('game.status'), 'won');
  assert.equal(ui.read('game.revealedCount'), 71);
  assert.equal(ui.get('#timer').textContent, '003');
  assert.equal(JSON.parse(ui.saved.get('fangcun-records')).easy, 3);
  ui.fire('#restart', 'click');
  ui.advance(1000);
  assert.equal(ui.read('game.status'), 'ready');
  assert.equal(ui.get('#timer').textContent, '000');
  assert.equal(ui.get('#result-dialog').open, false);
  assert.equal(ui.get('#best-time').innerHTML, '3<span> 秒</span>');
});
