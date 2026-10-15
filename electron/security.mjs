import { GAME_ORIGINS, isGameUrl } from './policy.mjs';

/* Everything the settings protocol will ever serve, by exact path under
   electron/settings/, with its content type. A fixed list: no directory
   is listed or walked, and a name not spelled out here is a 404. */
export const SETTINGS_ASSET_TYPES = Object.freeze(Object.assign(Object.create(null), {
  'index.html': 'text/html; charset=utf-8',
  'settings.css': 'text/css; charset=utf-8',
  'settings.js': 'text/javascript; charset=utf-8',
}));

export function settingsAssetName(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'bunnyhop-settings:' || url.hostname !== 'app' || url.port || url.username || url.password) return null;
    const name = url.pathname.replace(/^\//, '');
    return Object.hasOwn(SETTINGS_ASSET_TYPES, name) && !url.search && !url.hash ? name : null;
  } catch {
    return null;
  }
}

// Deep links resolve to bounded routes on the game origin.
export function deepLinkTarget(value) {
  try {
    if (String(value).length > 2048 || /(?:^|\/)\.{1,2}(?:\/|$)/.test(String(value))) return null;
    const u = new URL(value);
    if (u.protocol !== 'bunnyhop:' || u.username || u.password || u.port) return null;
    if (u.hostname === 'open') {
      const target = u.searchParams.get('url');
      return target && target.length <= 2048 && isGameUrl(target) ? target : null;
    }
    const id = decodeURIComponent(u.pathname.slice(1));
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || u.search || u.hash) return null;
    if (u.hostname === 'replay') return `https://bunnyhop.lol/replay/${encodeURIComponent(id)}`;
    if (u.hostname === 'map') return `https://bunnyhop.lol/?map=${encodeURIComponent(id)}`;
    if (u.hostname === 'server') return `https://bunnyhop.lol/?server=${encodeURIComponent(id)}`;
  } catch {}
  return null;
}

/* What the game saves to disk: player cards and banners (png), creator and
   settings exports (json), replay video (mp4/webm). Nothing executable,
   nothing an OS would open as a program. */
const DOWNLOAD_TYPES = Object.freeze({
  bhr: 'Bunnyhop replay',
  png: 'PNG image',
  jpg: 'JPEG image',
  jpeg: 'JPEG image',
  webp: 'WebP image',
  json: 'JSON',
  mp4: 'MP4 video',
  webm: 'WebM video',
  txt: 'Text',
  csv: 'CSV',
});

function downloadOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'data:') return 'data:';
    if (url.protocol === 'blob:') return new URL(url.pathname).origin;
    if (url.protocol === 'https:') return url.origin;
  } catch {
    // Refused below.
  }
  return null;
}

/**
 * A download the game page asked for, or null. The page must be the game,
 * the bytes must come from the game (its own blob: or data: URL, or its
 * origin), and the file type must be on the short list above. Returns the
 * file name to suggest and the save dialog filter; the player still picks
 * where it goes.
 */
export function downloadDecision({ pageUrl, downloadUrl, filename } = {}) {
  if (!isGameUrl(pageUrl)) return null;
  const origin = downloadOrigin(downloadUrl);
  if (origin !== 'data:' && !GAME_ORIGINS.includes(origin)) return null;
  const name = String(filename ?? '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toLowerCase();
  if (!extension || !Object.hasOwn(DOWNLOAD_TYPES, extension)) return null;
  return { filename: name, filter: { name: DOWNLOAD_TYPES[extension], extensions: [extension] } };
}

export function isArchivableRun(summary) {
  return Boolean(summary?.mapId) && !summary.mapId.startsWith('draft:') && summary.timeMs > 0;
}
const cleanText = (v,n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,n);
const bounded = (v,max,integer=false) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max && (!integer || Number.isInteger(v)) ? v : null;
export function sanitizeRunSummary(raw={}, {client='',now=new Date()}={}) {
 return {version:1,savedAt:now.toISOString(),mapId:cleanText(raw.mapId,80),mapName:cleanText(raw.mapName,80),style:cleanText(raw.style,32),timeMs:bounded(raw.timeMs,86400000),ticks:bounded(raw.ticks,1000000000,true),tickRate:bounded(raw.tickRate,1000),personalBest:raw.personalBest===true,verified:raw.verified===true,mode:['solo','multiplayer','practice','replay'].includes(raw.mode)?raw.mode:'solo',client:cleanText(client,32)};
}
