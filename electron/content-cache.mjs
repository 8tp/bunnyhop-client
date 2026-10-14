import { randomUUID, webcrypto } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_CACHE_FILE = 512 * 1024 * 1024;
const RESERVE = 512 * 1024 * 1024;
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/* Web Crypto hashes on libuv's thread pool; only copying the bytes happens
   here. The main process routes input to the game, and hashing a large map on
   its thread stalled it about four times longer (83 ms against 21 ms for
   256 MiB). */
const digest = async bytes => Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');

/** Persistent, content-addressed bytes only. No URLs, accounts, or manifests. */
export class ContentCache {
  constructor(root) { this.root = root; }
  file(hash) { return path.join(this.root, hash.slice(0, 2), hash); }
  async get(hash) {
    if (!validHash(hash)) return null;
    const file = this.file(hash);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_CACHE_FILE) return null;
      const bytes = await readFile(file);
      if (await digest(bytes) === hash) return bytes;
      await rm(file, { force: true });
    } catch { /* Missing, unreadable, or corrupt entries are ordinary misses. */ }
    return null;
  }
  async put(hash, bytes) {
    if (!validHash(hash) || !(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_CACHE_FILE) return false;
    if (await digest(bytes) !== hash) return false;
    const file = this.file(hash);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      const space = await statfs(this.root);
      if (space.bavail * space.bsize < bytes.byteLength + RESERVE) return false;
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporary, file);
      return true;
    } catch { return false; }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
}
