const { contextBridge, ipcRenderer } = require('electron');
/* Keep gameplay keys entirely in the renderer: a main-process before-input-event
   listener makes every key wait for main, even when it returns immediately.
   The trade-off is that these client hotkeys wait too if the renderer hangs.
   Capture in the isolated world before page listeners, and send only hotkeys. */
window.addEventListener('keydown', event => {
  if (event.key !== 'F9' && event.key !== 'F10' && event.key !== 'F11') return;
  if (!event.isTrusted) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  ipcRenderer.send('client:hotkey', event.key);
}, true);

const text = (v,n=80) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,n);
const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const room = v => v && typeof v === 'object' ? {id:text(v.id,40),lobby:v.lobby===true,players:number(v.players),max:number(v.max)} : null;
let benchmarkListener = null;
ipcRenderer.on('client:benchmark', (_event, value) => { if (benchmarkListener) try { benchmarkListener({seconds:number(value?.seconds) ?? 30}); } catch {} });
/* Custom CSS: the text of the player's own .css file and its base name, or null. Never a path. */
let customCssListener = null;
const customCss = v => v && typeof v === 'object' && typeof v.css === 'string' && v.css.length <= 262144 ? {name:text(v.name),css:v.css} : null;
ipcRenderer.on('client:custom-css', (_event, value) => { if (customCssListener) try { customCssListener(customCss(value)); } catch {} });
/* Each subscription gets its own initial snapshot. Pending subscribers ignore
   broadcasts until that snapshot arrives; unsubscribe also cancels late replies. */
let nextSkySubscription = 0;
const skyListeners = new Map();
ipcRenderer.on('client:custom-skies', (_event, subscription, skies) => {
  if (!Array.isArray(skies)) return;
  const targets = subscription === null ? [...skyListeners.values()].filter(v => v.ready) : [skyListeners.get(subscription)];
  for (const target of targets) {
    if (!target) continue;
    target.ready = true;
    try { target.listener(skies); } catch {}
  }
});
contextBridge.exposeInMainWorld('bunnyhopClient', Object.freeze({
  version: 1,
  onCustomSkies: listener => {
    if (typeof listener !== 'function') return () => {};
    const subscription = ++nextSkySubscription;
    skyListeners.set(subscription, { listener, ready: false });
    ipcRenderer.send('client:custom-skies-ready', subscription);
    return () => { skyListeners.delete(subscription); };
  },
  openSkiesFolder: () => ipcRenderer.invoke('client:open-skies-folder'),
  getCachedContent: hash => ipcRenderer.invoke('client:cache-get', hash),
  cacheContent: (hash, bytes) => ipcRenderer.invoke('client:cache-put', hash, bytes),
  getSettings: () => ipcRenderer.invoke('client:public-settings'),
  openSettings: () => ipcRenderer.invoke('client:open-settings'),
  setFullscreen: value => ipcRenderer.invoke('client:fullscreen', value === true),
  setPresence: (v={}) => ipcRenderer.send('client:presence', {kind:text(v.kind,16),mapId:text(v.mapId),mapName:text(v.mapName),mapImage:typeof v.mapImage === 'string' ? v.mapImage.slice(0,256) : null,style:text(v.style,32),mode:text(v.mode,16),startedAt:number(v.startedAt),room:room(v.room)}),
  resultSettled: archiveId => ipcRenderer.send('client:result-settled', text(archiveId,64)),
  saveRunSummary: (v={}) => ipcRenderer.invoke('client:save-run-summary', {mapId:text(v.mapId),mapName:text(v.mapName),style:text(v.style,32),timeMs:number(v.timeMs),ticks:number(v.ticks),tickRate:number(v.tickRate),personalBest:v.personalBest===true,verified:v.verified===true,mode:text(v.mode,16)}),
  /* The game's frame-time benchmark: F10 offers it once the game has registered. */
  onBenchmark: listener => {
    if (typeof listener !== 'function') return;
    benchmarkListener = listener;
    ipcRenderer.send('client:benchmark-ready');
  },
  benchmarkResult: v => { try { ipcRenderer.send('client:benchmark-result', v); } catch {} },
  /* Called with the current file at once (main answers custom-css-ready) and again on every save. */
  onCustomCss: listener => {
    if (typeof listener !== 'function') return () => {};
    customCssListener = listener;
    ipcRenderer.send('client:custom-css-ready');
    return () => { if (customCssListener === listener) customCssListener = null; };
  },
  onSettings: listener => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event,value) => listener(value);
    ipcRenderer.on('client:settings',wrapped);
    return () => ipcRenderer.removeListener('client:settings',wrapped);
  },
}));
