import { createPublicKey, verify } from 'node:crypto';

/* Release builds are not OS-signed (docs/releases.md), so the client never
   downloads or installs anything itself. It reads one small release note
   from the latest GitHub release, checks its Ed25519 signature against the
   key below, and says so when a newer version exists. A forged or altered
   note, or one pointing anywhere but the release pages, is ignored. */
export const UPDATE_FEED_URL = 'https://github.com/8tp/bunnyhop-client/releases/latest/download/bunnyhop-update.json';
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEARKy2xBqEAMieXg0d2Okq0hBjfiVOEK89F104JN62A98=
-----END PUBLIC KEY-----
`;
const MAX_FEED_BYTES = 64 * 1024;
const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

export function compareVersions(a, b) {
  const x = VERSION.exec(String(a)), y = VERSION.exec(String(b));
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return Math.sign(d);
  }
  return 0;
}

export function isReleasePage(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return false;
    if (u.hostname === 'github.com') return /^\/8tp\/bunnyhop-client\/releases(?:\/tag\/v\d{1,4}\.\d{1,4}\.\d{1,4})?\/?$/.test(u.pathname);
    return u.hostname === 'bunnyhop.lol' && /^\/download\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** The signed release note's fields, or null for anything unsigned or malformed. */
export function readSignedFeed(text, publicKey = RELEASE_PUBLIC_KEY) {
  try {
    if (typeof text !== 'string' || text.length > MAX_FEED_BYTES) return null;
    const envelope = JSON.parse(text);
    if (typeof envelope?.manifest !== 'string' || typeof envelope.signature !== 'string') return null;
    const signature = Buffer.from(envelope.signature, 'base64');
    if (signature.length !== 64 || !verify(null, Buffer.from(envelope.manifest, 'utf8'), createPublicKey(publicKey), signature)) return null;
    const m = JSON.parse(envelope.manifest);
    if (m?.schema !== 1 || m.product !== 'bunnyhop-client' || compareVersions(m.version, '0.0.0') === null || !isReleasePage(m.page)) return null;
    return {
      version: m.version,
      page: m.page,
      notes: typeof m.notes === 'string' ? m.notes.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 500) : '',
    };
  } catch {
    return null;
  }
}

export async function checkForUpdate({ fetch, currentVersion, publicKey = RELEASE_PUBLIC_KEY, url = UPDATE_FEED_URL, timeoutMs = 15_000 }) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (response.status === 404) return { state: 'current' };
    if (!response.ok) return { state: 'error', message: `release feed returned ${response.status}` };
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_FEED_BYTES) return { state: 'error', message: 'release feed is too large' };
    const feed = readSignedFeed(await response.text(), publicKey);
    if (!feed) return { state: 'error', message: 'release feed signature is not valid' };
    return compareVersions(feed.version, currentVersion) > 0 ? { state: 'available', ...feed } : { state: 'current' };
  } catch (error) {
    return { state: 'error', message: error.name === 'TimeoutError' ? 'release feed timed out' : error.message };
  }
}
