import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { CustomSkiesScanner, CustomSkiesWatcher, SKY_ERRORS, SKY_LIMIT, SKY_MAX_BYTES, ensureSkiesFolder, skyKind } from '../custom-skies.mjs';

const hdr = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
async function fixture(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bunnyhop-skies-test-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'Skies');
  await fs.promises.mkdir(folder);
  return { root, folder, write: (name, data = hdr) => fs.promises.writeFile(path.join(folder, name), data) };
}

test('only sky extensions are accepted; dot-files and traversal names are ignored', () => {
  for (const name of ['sun.hdr', 'sun.HDR']) assert.equal(skyKind(name), 'hdr');
  for (const name of ['sun.bhsky.json', 'sun.BHSKY.JSON']) assert.equal(skyKind(name), 'bhsky');
  for (const name of ['sky.png', 'sky.JPG', 'sky.jpeg', 'sky.webp']) assert.equal(skyKind(name), 'image');
  for (const name of ['sky.gif', 'sky.png.exe', '.sky.png']) assert.equal(skyKind(name), null);
  for (const name of ['.sun.hdr', 'sun.json', 'sun.hdr.exe', '../sun.hdr', 'a/sun.hdr', 'a\\sun.hdr', 'a\0.hdr', null]) assert.equal(skyKind(name), null);
});

test('scanner creates the folder and returns exact ArrayBuffers, names, kinds and millisecond mtimes', async t => {
  const { root, folder, write } = await fixture(t);
  assert.deepEqual(await new CustomSkiesScanner(path.join(root, 'new', 'Skies')).scan(), []);
  await write('radiance.hdr');
  await write('rgbe.HDR', '#?RGBE\r\n');
  await write('preset.bhsky.json', '{"sky":true}');
  await write('.hidden.hdr');
  await write('ignored.json', '{}');
  const skies = await new CustomSkiesScanner(folder).scan();
  assert.equal(skies.length, 3);
  for (const sky of skies) {
    assert.deepEqual(Object.keys(sky), ['name', 'kind', 'size', 'mtime', 'bytes']);
    assert.ok(sky.bytes instanceof ArrayBuffer);
    assert.equal(sky.bytes.byteLength, sky.size);
    assert.equal(sky.mtime, (await fs.promises.stat(path.join(folder, sky.name))).mtimeMs);
    assert.equal(sky.kind, sky.name.endsWith('.json') ? 'bhsky' : 'hdr');
  }
  assert.equal(Buffer.from(skies.find(s => s.name === 'radiance.hdr').bytes).toString(), hdr);
});

test('size limits are inclusive for every kind, and invalid HDR or picture magic is an error', async t => {
  const { folder, write } = await fixture(t);
  const scanner = new CustomSkiesScanner(folder);
  for (const [kind, max] of Object.entries(SKY_MAX_BYTES)) {
    const name = { hdr: 'limit.hdr', image: 'limit.png', bhsky: 'limit.bhsky.json' }[kind];
    await write(name, { hdr, image: PNG, bhsky: '{}' }[kind]);
    await fs.promises.truncate(path.join(folder, name), max);
    let sky = (await scanner.scan()).find(s => s.name === name);
    assert.equal(sky.size, max);
    assert.equal(sky.bytes.byteLength, max);
    await fs.promises.truncate(path.join(folder, name), max + 1);
    sky = (await scanner.scan()).find(s => s.name === name);
    assert.deepEqual(sky, { name, error: `File is over ${max / 1024 / 1024} MiB` });
  }
  for (const value of ['', 'not an HDR', '#?RADIANCEX\n', '#?RGBEX\n', Buffer.from([...hdr].map(c => c.charCodeAt(0) | 0x80))]) {
    await write('bad.hdr', value);
    assert.deepEqual((await scanner.scan()).find(s => s.name === 'bad.hdr'), { name: 'bad.hdr', error: SKY_ERRORS.hdr });
  }
  for (const value of ['', 'not a picture', 'GIF89a......', hdr]) {
    await write('bad.png', value);
    assert.deepEqual((await scanner.scan()).find(s => s.name === 'bad.png'), { name: 'bad.png', error: SKY_ERRORS.image });
  }
  for (const [name, value] of [['ok.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])], ['ok.webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')]]) {
    await write(name, value);
    assert.equal((await scanner.scan()).find(s => s.name === name).kind, 'image');
  }
});

test('only the newest 24 skies are read; excess files carry an error and enter when a newer file is removed', async t => {
  const { folder, write } = await fixture(t);
  for (let i = 0; i < SKY_LIMIT + 2; i++) {
    const name = `${i}.hdr`;
    await write(name);
    await fs.promises.utimes(path.join(folder, name), 1000 + i, 1000 + i);
  }
  let reads = 0;
  const scanner = new CustomSkiesScanner(folder, { fs: { ...fs, promises: { ...fs.promises, open: (...args) => { reads++; return fs.promises.open(...args); } } } });
  let skies = await scanner.scan();
  assert.equal(reads, 24);
  assert.equal(skies[0].name, '25.hdr');
  assert.equal(skies[23].name, '2.hdr');
  assert.deepEqual(skies.slice(24), [{ name: '1.hdr', error: SKY_ERRORS.limit }, { name: '0.hdr', error: SKY_ERRORS.limit }]);
  await fs.promises.unlink(path.join(folder, '25.hdr'));
  skies = await scanner.scan();
  assert.equal(reads, 25);
  assert.equal(skies[23].name, '1.hdr');
  assert.ok(skies[23].bytes instanceof ArrayBuffer);
});

test('unchanged bytes retain their cached ArrayBuffer; size, mtime, rename and deletion update the list', async t => {
  const { folder, write } = await fixture(t);
  let reads = 0;
  const scanner = new CustomSkiesScanner(folder, { fs: { ...fs, promises: { ...fs.promises, open: (...args) => { reads++; return fs.promises.open(...args); } } } });
  await write('one.hdr');
  await write('two.hdr');
  const first = await scanner.scan();
  const again = await scanner.scan();
  assert.equal(reads, 2);
  for (const sky of first) assert.equal(again.find(s => s.name === sky.name).bytes, sky.bytes);
  await fs.promises.chmod(path.join(folder, 'one.hdr'), 0o600);
  await scanner.scan();
  assert.equal(reads, 2, 'metadata other than size and mtime does not reread bytes');
  await fs.promises.utimes(path.join(folder, 'one.hdr'), 1234, 1234);
  await scanner.scan();
  assert.equal(reads, 3, 'mtime alone triggers a read');
  await write('one.hdr', hdr + 'more');
  await scanner.scan();
  assert.equal(reads, 4, 'size change triggers a read');
  await fs.promises.rename(path.join(folder, 'one.hdr'), path.join(folder, 'renamed.hdr'));
  await fs.promises.unlink(path.join(folder, 'two.hdr'));
  assert.deepEqual((await scanner.scan()).map(s => s.name), ['renamed.hdr']);
  assert.equal(scanner.cache.size, 1);
});

test('non-files and read failures have short errors, and symlinks are skipped even inside the folder', async t => {
  const { root, folder, write } = await fixture(t);
  await write('unreadable.hdr');
  await write('good.hdr');
  await fs.promises.mkdir(path.join(folder, 'directory.hdr'));
  const outside = path.join(root, 'outside.hdr');
  await fs.promises.writeFile(outside, hdr);
  await fs.promises.symlink(outside, path.join(folder, 'outside-link.hdr'));
  await fs.promises.symlink(path.join(folder, 'good.hdr'), path.join(folder, 'inside-link.hdr'));
  const scanner = new CustomSkiesScanner(folder, { fs: { ...fs, promises: { ...fs.promises,
    open: (file, ...args) => { if (file.endsWith('unreadable.hdr')) throw new Error('EACCES'); return fs.promises.open(file, ...args); },
  } } });
  const skies = await scanner.scan();
  assert.deepEqual(skies.find(s => s.name === 'unreadable.hdr'), { name: 'unreadable.hdr', error: SKY_ERRORS.unreadable });
  assert.deepEqual(skies.find(s => s.name === 'directory.hdr'), { name: 'directory.hdr', error: SKY_ERRORS.notFile });
  assert.equal(skies.length, 3);
  const linkedFolder = path.join(root, 'linked');
  await fs.promises.symlink(folder, linkedFolder, 'dir');
  await assert.rejects(ensureSkiesFolder(linkedFolder), /real directory/);
});

test('a file replaced after lstat or grown during a read is refused', async t => {
  const { folder, write } = await fixture(t);
  await write('race.hdr');
  for (const race of ['replace', 'grow']) {
    const scanner = new CustomSkiesScanner(folder, { fs: { ...fs, promises: { ...fs.promises,
      open: async (...args) => {
        const handle = await fs.promises.open(...args);
        const stat = handle.stat.bind(handle);
        let calls = 0;
        handle.stat = async () => {
          const result = await stat();
          if (race === 'replace') result.ino++;
          if (race === 'grow' && ++calls === 2) result.size = SKY_MAX_BYTES.hdr + 1;
          return result;
        };
        return handle;
      },
    } } });
    const [sky] = await scanner.scan();
    assert.equal(sky.error, race === 'replace' ? SKY_ERRORS.unreadable : 'File is over 16 MiB');
    assert.equal(sky.bytes, undefined);
  }
});

function until(check, label) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => { clearInterval(timer); reject(new Error(label)); }, 5000);
    const timer = setInterval(() => { if (check()) { clearInterval(timer); clearTimeout(deadline); resolve(); } }, 10);
  });
}

test('watcher debounces rename saves, reports deletion, recovers a replaced folder, and closes', async t => {
  const { folder, write } = await fixture(t);
  const seen = [];
  const watcher = new CustomSkiesWatcher(folder, { debounceMs: 30, retryMs: 30, onChange: v => seen.push(v) });
  t.after(() => watcher.close());
  await watcher.start();
  await write('.save.tmp');
  await fs.promises.rename(path.join(folder, '.save.tmp'), path.join(folder, 'sky.hdr'));
  await until(() => seen.at(-1)?.[0]?.name === 'sky.hdr', 'rename save not reported');
  const count = seen.length;
  await watcher.refresh();
  assert.equal(seen.length, count, 'unchanged refresh is silent');
  await fs.promises.unlink(path.join(folder, 'sky.hdr'));
  await until(() => seen.at(-1)?.length === 0, 'deletion not reported');
  await fs.promises.rm(folder, { recursive: true });
  await watcher.refresh();
  await write('returned.hdr');
  await until(() => seen.at(-1)?.[0]?.name === 'returned.hdr', 'replacement folder not watched');
  watcher.schedule();
  watcher.close();
  assert.equal(watcher.watcher, null);
  assert.equal(watcher.scanner.cache.size, 0);
});

test('watcher coalesces event bursts, retries watch errors, and ignores stale watcher callbacks', async t => {
  const { folder } = await fixture(t);
  const watches = [];
  let failNextWatch = false;
  const watcher = new CustomSkiesWatcher(folder, { debounceMs: 30, retryMs: 30,
    fs: { ...fs, watch: (_root, _options, listener) => {
      if (failNextWatch) { failNextWatch = false; throw new Error('temporarily unavailable'); }
      const watch = Object.assign(new EventEmitter(), { listener, close() {} });
      watches.push(watch);
      return watch;
    } },
  });
  t.after(() => watcher.close());
  const scan = watcher.scanner.scan.bind(watcher.scanner);
  let scans = 0;
  watcher.scanner.scan = () => { scans++; return scan(); };
  await watcher.start();
  // The fake native watcher emits nothing during startup: reconciliation
  // still finds a file dropped immediately after the initial snapshot.
  await fs.promises.writeFile(path.join(folder, 'early.hdr'), hdr);
  await until(() => watcher.value[0]?.name === 'early.hdr' && !watcher.pending, 'startup drop was missed');
  assert.equal(scans, 2);
  for (let i = 0; i < 10; i++) watches[0].listener();
  await until(() => scans === 3 && !watcher.pending, 'burst was not scanned');
  assert.equal(scans, 3);
  failNextWatch = true;
  watches[0].emit('error', new Error('watch failed'));
  await until(() => watches.length === 2 && !watcher.pending, 'failed attach was not retried');
  const current = watcher.watcher;
  const timer = watcher.timer;
  watches[0].emit('error', new Error('late error'));
  watches[0].listener();
  assert.equal(watcher.watcher, current);
  assert.equal(watcher.timer, timer);
});
