import * as nodeFs from 'node:fs';
import path from 'node:path';

export const SKY_LIMIT = 24;
export const SKY_MAX_BYTES = Object.freeze({ hdr: 16 * 1024 * 1024, image: 32 * 1024 * 1024, bhsky: 45 * 1024 * 1024 });
export const SKY_DEBOUNCE_MS = 300;
export const SKY_ERRORS = Object.freeze({
  notFile: 'Not a regular file',
  unreadable: 'Can’t read the file',
  hdr: 'Not a Radiance HDR file',
  image: 'Not a PNG, JPEG or WebP picture',
  limit: 'Only the 24 newest skies are loaded',
});

export function skyKind(name) {
  // Names come from readdir, never from the page. Reject separators anyway.
  if (typeof name !== 'string' || name.startsWith('.') || /[/\\\u0000]/.test(name)) return null;
  if (/\.bhsky\.json$/i.test(name)) return 'bhsky';
  if (/\.(?:png|jpe?g|webp)$/i.test(name)) return 'image';
  return /\.hdr$/i.test(name) ? 'hdr' : null;
}

/** PNG, JPEG or WebP by its first bytes (the game decodes and checks it fully). */
function isPicture(b) {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return true;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  return b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
}

export async function ensureSkiesFolder(folder, fs = nodeFs) {
  await fs.promises.mkdir(folder, { recursive: true });
  const stat = await fs.promises.lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Skies folder must be a real directory');
  return { root: await fs.promises.realpath(folder), stat };
}

/** Async, bounded reads only. The cache owns exact-sized ArrayBuffers, not
 * pooled Node Buffers, so IPC structured-clones only the intended bytes. */
export class CustomSkiesScanner {
  constructor(folder, { fs = nodeFs } = {}) {
    this.folder = folder;
    this.fs = fs;
    this.cache = new Map();
  }

  async scan() {
    const { root } = await ensureSkiesFolder(this.folder, this.fs);
    const files = [];
    for (const name of await this.fs.promises.readdir(root)) {
      const kind = skyKind(name);
      if (!kind) continue;
      const file = path.join(root, name);
      try {
        const stat = await this.fs.promises.lstat(file);
        // Skip all symlinks, including links that currently point inside.
        if (stat.isSymbolicLink()) continue;
        if (path.dirname(await this.fs.promises.realpath(file)) !== root) continue;
        files.push({ name, kind, file, stat });
      } catch {
        files.push({ name, error: SKY_ERRORS.unreadable });
      }
    }
    files.sort((a, b) => (b.stat?.mtimeMs ?? -Infinity) - (a.stat?.mtimeMs ?? -Infinity) || a.name.localeCompare(b.name));
    const next = new Map();
    const skies = [];
    for (const [index, item] of files.entries()) {
      const { name, kind, stat } = item;
      if (index >= SKY_LIMIT) { skies.push({ name, error: SKY_ERRORS.limit }); continue; }
      if (item.error) { skies.push({ name, error: item.error }); continue; }
      if (!stat.isFile()) { skies.push({ name, error: SKY_ERRORS.notFile }); continue; }
      const key = `${root}:${stat.size}:${stat.mtimeMs}`;
      const cached = this.cache.get(name);
      const value = cached?.key === key ? cached.value : await this.read(item);
      next.set(name, { key, value });
      skies.push(value);
    }
    this.cache = next;
    return skies;
  }

  async read({ name, kind, file, stat }) {
    const fail = error => ({ name, error });
    if (!stat.isFile()) return fail(SKY_ERRORS.notFile);
    const max = SKY_MAX_BYTES[kind];
    const tooBig = `File is over ${max / 1024 / 1024} MiB`;
    if (stat.size > max) return fail(tooBig);
    let handle;
    try {
      // O_NOFOLLOW prevents a leaf being swapped for a symlink between lstat
      // and open on Unix; identity checks also cover replacement on Windows.
      handle = await this.fs.promises.open(file, nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW || 0) | nodeFs.constants.O_NONBLOCK);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) return fail(SKY_ERRORS.unreadable);
      if (opened.size > max) return fail(tooBig);
      const buffer = Buffer.alloc(Math.min(max, opened.size) + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat();
      if (length > max || after.size > max) return fail(tooBig);
      if (length !== after.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) return fail('File changed while reading; save it again');
      if (kind === 'hdr' && !/^#\?(?:RADIANCE|RGBE)(?:\r?\n|$)/.test(buffer.subarray(0, Math.min(length, 12)).toString('latin1'))) return fail(SKY_ERRORS.hdr);
      if (kind === 'image' && !isPicture(buffer.subarray(0, Math.min(length, 12)))) return fail(SKY_ERRORS.image);
      return { name, kind, size: length, mtime: stat.mtimeMs, bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + length) };
    } catch { return fail(SKY_ERRORS.unreadable); }
    finally { try { await handle?.close(); } catch {} }
  }
}

/** One serial scan at a time, with folder events coalesced off the input path. */
export class CustomSkiesWatcher {
  constructor(folder, { fs = nodeFs, onChange = () => {}, onError = () => {}, debounceMs = SKY_DEBOUNCE_MS, retryMs = 2000 } = {}) {
    this.scanner = new CustomSkiesScanner(folder, { fs });
    this.fs = fs;
    this.onChange = onChange;
    this.onError = onError;
    this.debounceMs = debounceMs;
    this.retryMs = retryMs;
    this.value = [];
    this.active = false;
  }

  start() { this.active = true; return this.refresh(); }

  refresh() {
    this.dirty = true;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      while (this.active && this.dirty) {
        this.dirty = false;
        try {
          const { root, stat } = await ensureSkiesFolder(this.scanner.folder, this.fs);
          if (!this.active) break;
          const identity = `${root}:${stat.dev}:${stat.ino}`;
          if (!this.watcher || this.identity !== identity) {
            this.watcher?.close();
            this.watcher = null;
            const watcher = this.fs.watch(root, { persistent: false }, () => {
              if (this.watcher === watcher) this.schedule();
            });
            this.watcher = watcher;
            this.identity = identity;
            watcher.on('error', error => {
              if (this.watcher !== watcher) return;
              watcher.close();
              this.watcher = null;
              this.onError(error);
              this.schedule(this.retryMs);
            });
            // Some native watchers take a moment to attach. Reconcile once
            // after startup so an immediate drop/rename cannot slip through.
            this.schedule();
          }
          const value = await this.scanner.scan();
          if (!this.active) { this.scanner.cache.clear(); break; }
          const changed = value.length !== this.value.length || value.some((v, i) => v !== this.value[i] &&
            (v.name !== this.value[i]?.name || v.error !== this.value[i]?.error || v.bytes !== this.value[i]?.bytes));
          this.value = value;
          if (changed) this.onChange(value);
        } catch (error) {
          this.onError(error);
          this.schedule(this.retryMs);
        }
      }
    })().finally(() => { this.pending = null; });
    return this.pending;
  }

  schedule(ms = this.debounceMs) {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, ms);
    this.timer.unref?.();
  }

  close() {
    this.active = false;
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
    this.scanner.cache.clear();
    this.value = [];
  }
}
