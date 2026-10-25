import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CUSTOM_CSS_ERRORS,
  CUSTOM_CSS_MAX_BYTES,
  CustomCssWatcher,
  customCssName,
  readCustomCss,
  sanitizeCustomCssPath,
} from '../custom-css.mjs';
import { sanitizeSettings } from '../settings.mjs';

const temp = () => mkdtempSync(path.join(os.tmpdir(), 'bunnyhop-css-test-'));

test('the settings keep only an absolute path to a .css file', () => {
  const file = path.resolve(os.tmpdir(), 'theme.css');
  assert.equal(sanitizeSettings().customCssPath, null);
  assert.equal(sanitizeSettings({ customCssPath: file }).customCssPath, file);
  assert.equal(sanitizeSettings({ customCssPath: file.replace(/css$/, 'CSS') }).customCssPath, file.replace(/css$/, 'CSS'));
  for (const bad of ['theme.css', './theme.css', path.resolve(os.tmpdir(), 'theme.js'), path.resolve(os.tmpdir(), 'theme.css.exe'),
    `${path.resolve(os.tmpdir(), 'a\n')}.css`, `${path.resolve(os.tmpdir(), 'x'.repeat(4096))}.css`, 42, {}, '', true]) {
    assert.equal(sanitizeSettings({ customCssPath: bad }).customCssPath, null, String(bad).slice(0, 40));
  }
  assert.equal(sanitizeCustomCssPath('C:\\Users\\a\\theme.css', path.win32), 'C:\\Users\\a\\theme.css');
  assert.equal(sanitizeCustomCssPath('theme.css', path.win32), null);
});

test('older settings files need no migration for custom CSS', () => {
  assert.equal(sanitizeSettings({ version: 2, profile: 'competitive' }).customCssPath, null);
});

test('the game is told the base name only, without control characters', () => {
  assert.equal(customCssName('/home/a/themes/theme.css'), 'theme.css');
  assert.equal(customCssName(`/home/a/${'x'.repeat(100)}\u0007.css`).length, 80);
  assert.equal(customCssName(null), '');
});

test('reading: text and name, a missing file, a file over 256 KB, a folder', () => {
  const dir = temp();
  try {
    const file = path.join(dir, 'theme.css');
    writeFileSync(file, '\uFEFF:root { --accent: red; }');
    assert.deepEqual(readCustomCss(file), { value: { name: 'theme.css', css: ':root { --accent: red; }' }, error: null });
    assert.deepEqual(readCustomCss(path.join(dir, 'gone.css')), { value: null, error: CUSTOM_CSS_ERRORS.missing });
    writeFileSync(file, 'a'.repeat(CUSTOM_CSS_MAX_BYTES + 1));
    assert.deepEqual(readCustomCss(file), { value: null, error: CUSTOM_CSS_ERRORS.tooBig });
    writeFileSync(file, 'a'.repeat(CUSTOM_CSS_MAX_BYTES));
    assert.equal(readCustomCss(file).value.css.length, CUSTOM_CSS_MAX_BYTES);
    assert.deepEqual(readCustomCss(dir), { value: null, error: CUSTOM_CSS_ERRORS.notFile });
    assert.deepEqual(readCustomCss(null), { value: null, error: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* An in-memory folder with fs.watch events, and timers run by hand. */
function fakes() {
  const files = new Map();
  const watchers = [];
  const fs = {
    statSync(file) {
      if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isFile: () => true, size: Buffer.byteLength(files.get(file)) };
    },
    readFileSync(file) {
      fs.reads += 1;
      if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return Buffer.from(files.get(file));
    },
    watch(directory, _options, listener) {
      const watcher = Object.assign(new EventEmitter(), { directory, listener, closed: false, close() { this.closed = true; } });
      watchers.push(watcher);
      return watcher;
    },
    reads: 0,
  };
  const timers = new Set();
  const clock = {
    setTimeout(fn, ms) { const t = { fn, ms }; timers.add(t); return t; },
    clearTimeout(t) { timers.delete(t); },
    run() { for (const t of [...timers]) { timers.delete(t); t.fn(); } },
    pending: () => timers.size,
  };
  const emit = (name, type = 'rename') => { for (const w of watchers) if (!w.closed) w.listener(type, name); };
  return { files, watchers, fs, clock, emit };
}

test('the watcher reports the file at once, watches its folder, and debounces a save into one read', () => {
  const { files, watchers, fs, clock, emit } = fakes();
  const file = path.resolve('/themes/theme.css');
  files.set(file, 'a{}');
  const seen = [];
  const watcher = new CustomCssWatcher({ fs, ...clock, onChange: (v) => seen.push(v) });
  watcher.watch(file);
  assert.deepEqual(seen, [{ value: { name: 'theme.css', css: 'a{}' }, error: null }]);
  assert.equal(watchers.length, 1);
  assert.equal(watchers[0].directory, path.dirname(file));

  // A VS Code or vim save: a temporary file, then a rename over the old one, several events.
  const reads = fs.reads;
  emit('.theme.css.swp', 'change');
  assert.equal(clock.pending(), 0, 'other files in the folder are ignored');
  files.set(file, 'b{}');
  emit('theme.css', 'rename');
  emit('theme.css', 'change');
  emit('theme.css', 'change');
  assert.equal(clock.pending(), 1);
  clock.run();
  assert.equal(fs.reads, reads + 1);
  assert.deepEqual(seen.at(-1), { value: { name: 'theme.css', css: 'b{}' }, error: null });

  // A save with the same text sends nothing new.
  emit('theme.css');
  clock.run();
  assert.equal(seen.length, 2);
});

test('the file disappearing sends null, and coming back sends it again', () => {
  const { files, fs, clock, emit } = fakes();
  const file = path.resolve('/themes/theme.css');
  files.set(file, 'a{}');
  const seen = [];
  const watcher = new CustomCssWatcher({ fs, ...clock, onChange: (v) => seen.push(v) });
  watcher.watch(file);
  files.delete(file);
  emit('theme.css');
  clock.run();
  assert.deepEqual(seen.at(-1), { value: null, error: CUSTOM_CSS_ERRORS.missing });
  files.set(file, 'c{}');
  emit('theme.css');
  clock.run();
  assert.deepEqual(seen.at(-1), { value: { name: 'theme.css', css: 'c{}' }, error: null });
  assert.equal(seen.length, 3);
});

test('a file grown over 256 KB sends null with an error', () => {
  const { files, fs, clock, emit } = fakes();
  const file = path.resolve('/themes/theme.css');
  files.set(file, 'a{}');
  const seen = [];
  const watcher = new CustomCssWatcher({ fs, ...clock, onChange: (v) => seen.push(v) });
  watcher.watch(file);
  files.set(file, 'a'.repeat(CUSTOM_CSS_MAX_BYTES + 10));
  emit(null);
  clock.run();
  assert.deepEqual(seen.at(-1), { value: null, error: CUSTOM_CSS_ERRORS.tooBig });
});

test('changing or clearing the file closes the old watcher; close stops pending reads', () => {
  const { files, watchers, fs, clock, emit } = fakes();
  const one = path.resolve('/a/one.css');
  const two = path.resolve('/b/two.css');
  files.set(one, 'a{}');
  files.set(two, 'b{}');
  const seen = [];
  const watcher = new CustomCssWatcher({ fs, ...clock, onChange: (v) => seen.push(v) });
  watcher.watch(one);
  watcher.watch(two);
  assert.equal(watchers[0].closed, true);
  assert.equal(watchers[1].closed, false);
  assert.equal(seen.at(-1).value.name, 'two.css');
  emit('two.css');
  watcher.watch(null);
  assert.equal(clock.pending(), 0);
  assert.equal(watchers[1].closed, true);
  assert.deepEqual(seen.at(-1), { value: null, error: null });
  watcher.watch(one);
  emit('one.css');
  watcher.close();
  assert.equal(clock.pending(), 0);
  assert.equal(watchers[2].closed, true);
});

test('a missing folder is looked for again until it comes back', () => {
  const { files, fs, clock } = fakes();
  const file = path.resolve('/usb/theme.css');
  let folder = false;
  const watch = fs.watch;
  fs.watch = (...args) => {
    if (!folder) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return watch(...args);
  };
  const seen = [];
  const watcher = new CustomCssWatcher({ fs, ...clock, onChange: (v) => seen.push(v) });
  watcher.watch(file);
  assert.deepEqual(seen.at(-1), { value: null, error: CUSTOM_CSS_ERRORS.missing });
  assert.equal(clock.pending(), 1);
  clock.run();
  assert.equal(clock.pending(), 1, 'still retrying');
  folder = true;
  files.set(file, 'a{}');
  clock.run();
  assert.deepEqual(seen.at(-1), { value: { name: 'theme.css', css: 'a{}' }, error: null });
  assert.equal(watcher.watcher !== null, true);
  watcher.close();
});

test('a real rename-over save on disk reaches the listener', async () => {
  const dir = temp();
  const file = path.join(dir, 'theme.css');
  writeFileSync(file, 'a{}');
  let watcher;
  try {
    const next = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no update after a rename save')), 5000);
      watcher = new CustomCssWatcher({
        onChange: (v) => { if (v.value?.css === 'b{}') { clearTimeout(timer); resolve(v); } },
      });
    });
    watcher.watch(file);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const temporary = path.join(dir, '.theme.css.tmp');
    writeFileSync(temporary, 'b{}');
    renameSync(temporary, file);
    assert.deepEqual((await next).value, { name: 'theme.css', css: 'b{}' });
    const gone = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no update after a delete')), 5000);
      watcher.onChange = (v) => { if (v.value === null) { clearTimeout(timer); resolve(v); } };
    });
    unlinkSync(file);
    assert.equal((await gone).error, CUSTOM_CSS_ERRORS.missing);
  } finally {
    watcher?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
