import test from 'node:test';
import assert from 'node:assert/strict';
import { PRIORITY_CLASSES, applyPriority, priorityTargets } from '../process-priority.mjs';

const metrics = [
  { pid: 10, type: 'Browser' }, { pid: 11, type: 'GPU' }, { pid: 12, type: 'Tab' },
  { pid: 13, type: 'Tab' }, { pid: 14, type: 'Utility' }, { pid: -1, type: 'GPU' },
];

test('the browser, GPU and game renderer are raised; other tabs and utilities are not', () => {
  assert.deepEqual(priorityTargets(metrics, 12), [10, 11, 12]);
  assert.deepEqual(priorityTargets(metrics, 0), [10, 11]);
});

test('priority is applied on Windows only, and Normal changes nothing', () => {
  const calls = [];
  const setPriority = (pid, value) => calls.push([pid, value]);
  assert.deepEqual(applyPriority({ priority: 'above-normal', metrics, gamePid: 12, platform: 'darwin', setPriority }), []);
  assert.deepEqual(applyPriority({ priority: 'normal', metrics, gamePid: 12, platform: 'win32', setPriority }), []);
  assert.deepEqual(applyPriority({ priority: 'high', metrics, gamePid: 12, platform: 'win32', setPriority }), []);
  assert.deepEqual(applyPriority({ priority: 'above-normal', metrics, gamePid: 12, platform: 'win32', setPriority }), [10, 11, 12]);
  assert.ok(calls.every(([, value]) => value === PRIORITY_CLASSES['above-normal']));
});

test('a process that refuses is skipped', () => {
  const raised = applyPriority({ priority: 'above-normal', metrics, gamePid: 12, platform: 'win32', setPriority: (pid) => { if (pid === 11) throw new Error('denied'); } });
  assert.deepEqual(raised, [10, 12]);
});
