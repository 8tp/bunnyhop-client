import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function preload() {
  const handlers = new Map();
  const messages = [];
  let bridge;
  vm.runInNewContext(readFileSync(new URL('../game-preload.cjs', import.meta.url), 'utf8'), {
    window: { addEventListener() {} },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: {
        on: (channel, listener) => handlers.set(channel, listener),
        send: (...args) => messages.push(args),
        invoke: (...args) => { messages.push(args); return Promise.resolve('opened'); },
      },
    }),
  });
  return { bridge, messages, deliver: (id, skies) => handlers.get('client:custom-skies')({}, id, skies) };
}

test('skies bridge stays version 1 and exposes subscription plus folder reveal only', async () => {
  const { bridge, messages } = preload();
  assert.equal(bridge.version, 1);
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(typeof bridge.onCustomSkies, 'function');
  assert.equal(await bridge.openSkiesFolder('/ignored/page/path'), 'opened');
  assert.deepEqual(messages, [['client:open-skies-folder']]);
  assert.equal(bridge.readSky, undefined);
  assert.equal(bridge.send, undefined);
});

test('every listener gets its own initial list, then broadcasts; unsubscribe cancels pending replies', () => {
  const { bridge, messages, deliver } = preload();
  const one = [], two = [];
  const offOne = bridge.onCustomSkies(value => one.push(value));
  const idOne = messages.at(-1)[1];
  const list = [{ name: 'sky.hdr', kind: 'hdr', size: 8, mtime: 1, bytes: new ArrayBuffer(8) }];
  deliver(null, list);
  assert.equal(one.length, 0, 'wait for initial snapshot');
  deliver(idOne, list);
  assert.equal(one[0], list);
  const offTwo = bridge.onCustomSkies(value => two.push(value));
  const idTwo = messages.at(-1)[1];
  deliver(idTwo, list);
  assert.equal(one.length, 1, 'new subscription does not repeat other initial callbacks');
  assert.equal(two[0], list);
  deliver(null, []);
  assert.equal(one.length, 2);
  assert.equal(two.length, 2);
  offOne();
  offOne();
  offTwo();
  deliver(null, list);
  deliver(idOne, list);
  assert.equal(one.length, 2);
  assert.equal(two.length, 2);
  const offPending = bridge.onCustomSkies(() => assert.fail('unsubscribed pending listener called'));
  const pending = messages.at(-1)[1];
  offPending();
  deliver(pending, list);
  bridge.onCustomSkies(null)();
});

test('a throwing listener does not prevent delivery to other subscribers', () => {
  const { bridge, messages, deliver } = preload();
  bridge.onCustomSkies(() => { throw new Error('page callback'); });
  deliver(messages.at(-1)[1], []);
  let received = 0;
  bridge.onCustomSkies(() => received++);
  deliver(messages.at(-1)[1], []);
  deliver(null, []);
  assert.equal(received, 2);
});
