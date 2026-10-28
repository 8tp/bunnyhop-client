import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../game-preload.cjs', import.meta.url), 'utf8');

function preload() {
  const listeners = [];
  const messages = [];
  let bridge;
  vm.runInNewContext(source, {
    window: { addEventListener: (...args) => listeners.push(args) },
    require: name => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
        ipcRenderer: { on() {}, send: (...args) => messages.push(args) },
      };
    },
  });
  assert.equal(listeners.length, 1);
  const [type, listener, capture] = listeners[0];
  assert.equal(type, 'keydown');
  assert.equal(capture, true, 'intercept before game listeners in the main world');
  const dispatch = (key, extra = {}) => {
    const event = {
      key, isTrusted: true, repeat: false,
      defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
      ...extra,
    };
    listener(event);
    return event;
  };
  return { dispatch, messages, bridge };
}

test('gameplay keys pass unchanged without IPC, including modifiers and repeats', () => {
  const { dispatch, messages } = preload();
  for (const key of ['a', 'A', 'd', 'D', 'w', 's', ' ', 'Shift', 'Control', 'Escape', 'F1', 'F8', 'F12']) {
    for (const repeat of [false, true]) {
      const event = dispatch(key, { repeat, shiftKey: true, ctrlKey: true });
      assert.equal(event.defaultPrevented, false, key);
      assert.equal(event.stopped, false, key);
    }
  }
  assert.deepEqual(messages, []);
});

for (const key of ['F9', 'F10', 'F11']) {
  test(`${key} is consumed before the page and sends only its key asynchronously`, () => {
    const { dispatch, messages } = preload();
    const event = dispatch(key);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
    assert.deepEqual(messages, [['client:hotkey', key]]);
  });

  test(`${key} preserves the existing repeat and modifier behavior`, () => {
    const { dispatch, messages } = preload();
    dispatch(key, { repeat: true, shiftKey: true, ctrlKey: true, altKey: true, metaKey: true });
    assert.deepEqual(messages, [['client:hotkey', key]]);
  });

  test(`synthetic ${key} does not invoke a native client action`, () => {
    const { dispatch, messages } = preload();
    const event = dispatch(key, { isTrusted: false });
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.stopped, false);
    assert.deepEqual(messages, []);
  });
}

test('the page bridge does not expose hotkey IPC', () => {
  const { bridge } = preload();
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(bridge.version, 1);
  assert.equal(bridge.hotkey, undefined);
  assert.equal(bridge.send, undefined);
});
