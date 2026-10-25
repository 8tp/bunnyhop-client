const api = window.bunnyhopSettings;
const form = document.querySelector('#settings-form');
const $ = selector => document.querySelector(selector);
/* Changing one of these by hand leaves the named profile. */
const PROFILE_KEYS = ['windowMode', 'preferredDisplay', 'preferHighestRefresh', 'uncap', 'preferDiscreteGpu', 'gpuBackend', 'pinDeviceScale', 'processPriority'];
let settings;

/* ---- feedback: a toast for actions, a tick at the foot of the rail for saves */
let statusTimer = 0;
function show(text, tone = 'ok') {
  const status = $('#status');
  status.textContent = text;
  status.dataset.tone = tone;
  status.classList.add('on');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => status.classList.remove('on'), 2400);
}
let savedTimer = 0;
function flashSaved() {
  const tick = $('#saved');
  tick.classList.remove('on');
  void tick.offsetWidth;
  tick.classList.add('on');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => tick.classList.remove('on'), 600);
}

/* ---- settings in and out of the form */
function setSeg(name, value) {
  for (const button of form.querySelectorAll(`[data-seg="${name}"] button`)) {
    const on = button.value === value;
    button.classList.toggle('on', on);
    button.setAttribute('aria-checked', String(on));
  }
}
function dependsOn(name, off) {
  form.elements[name].disabled = off;
  form.elements[name].closest('.set-row').classList.toggle('off', off);
}
function fill(value, restart = false) {
  settings = value;
  for (const el of form.elements) {
    if (!el.name || !Object.hasOwn(value, el.name)) continue;
    if (el.type === 'checkbox') el.checked = value[el.name];
    else el.value = value[el.name];
  }
  for (const seg of form.querySelectorAll('[data-seg]')) setSeg(seg.dataset.seg, value[seg.dataset.seg]);
  /* Switches that mean nothing while the one above them is off. */
  const presenceOff = !value.discordRichPresence || value.privacyMode;
  dependsOn('discordShowMap', presenceOff);
  dependsOn('discordJoin', presenceOff);
  dependsOn('discordJoinLobbies', presenceOff || !value.discordJoin);
  dependsOn('capturePersonalBests', !value.localRunVault);
  $('#restart-bar').hidden = !restart;
}
function read() {
  const value = { ...settings };
  for (const el of form.elements) if (el.name) value[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  return value;
}

/* Every change saves at once. Saves run one at a time, each sending the form as it is then. */
let saving = Promise.resolve();
function save() {
  saving = saving.then(async () => {
    try {
      const result = await api.save(read());
      fill(result.settings, result.requiresRestart);
      flashSaved();
    } catch (error) { show(error.message, 'bad'); }
  });
  return saving;
}
function applyPreset(profile) {
  saving = saving.then(async () => {
    try {
      const result = await api.applyPreset(profile);
      fill(result.settings, result.requiresRestart);
      flashSaved();
    } catch (error) { show(error.message, 'bad'); }
  });
}

form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('change', event => {
  if (PROFILE_KEYS.includes(event.target.name)) form.elements.profile.value = 'custom';
  save();
});
for (const seg of form.querySelectorAll('[data-seg]')) {
  const name = seg.dataset.seg;
  for (const button of seg.querySelectorAll('button')) {
    button.setAttribute('role', 'radio');
    button.addEventListener('click', () => {
      if (button.disabled || button.classList.contains('on')) return;
      setSeg(name, button.value);
      if (name === 'profile') return applyPreset(button.value);
      form.elements[name].value = button.value;
      form.elements.profile.value = 'custom';
      save();
    });
  }
}

/* ---- the help line: the row under the pointer or focus explains itself */
const help = $('#help');
function explain(event) {
  const row = event.target.closest?.('[data-help]');
  if (row) help.textContent = row.dataset.help;
}
form.addEventListener('pointerover', explain);
form.addEventListener('focusin', explain);

/* ---- rail: jump to a section; the section at the top of the page lights its rail item */
const scroller = $('#scroll');
const sections = [...document.querySelectorAll('.set-sec')];
const railItems = [...document.querySelectorAll('.set-rail-item')];
let jumpedAt = 0;
function light(id) {
  for (const item of railItems) item.classList.toggle('on', item.dataset.target === id);
}
for (const item of railItems) {
  item.addEventListener('click', () => {
    const section = document.getElementById(item.dataset.target);
    jumpedAt = performance.now();
    light(item.dataset.target);
    section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
}
scroller.addEventListener('scroll', () => {
  if (performance.now() - jumpedAt < 600) return;
  const band = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.3;
  let current = sections[0];
  for (const section of sections) if (section.getBoundingClientRect().top <= band) current = section;
  light(current.id);
}, { passive: true });
/* Room under the last section, so the rail can bring it to the top. */
function sizeTail() {
  const last = sections.at(-1);
  scroller.style.setProperty('--set-tail', `${Math.max(24, scroller.clientHeight - last.offsetHeight - 24)}px`);
}
new ResizeObserver(sizeTail).observe(scroller);

/* ---- status lines */
const DISCORD = {
  ready: ['Connected', 'ok'],
  connecting: ['Connecting', 'busy'],
  reconnecting: ['Looking for Discord', 'busy'],
  disconnected: ['Discord is closed', 'bad'],
  error: ['Can’t reach Discord', 'bad'],
  'missing-application-id': ['Not set up', 'bad'],
  disabled: ['Off', ''],
};
function discord(value) {
  const [text, tone] = DISCORD[value?.state] || [String(value?.state || ''), ''];
  const el = $('#discord-status');
  el.textContent = text;
  el.dataset.tone = tone;
  el.title = value?.message || '';
}
function update(value) {
  const text = { available: `${value.version} is out`, current: 'Up to date', error: 'Last check failed' }[value?.state] || '';
  $('#update-status').textContent = text;
  $('#update-status').title = value?.state === 'available' ? value.notes || '' : value?.message || '';
  $('#open-update').hidden = value?.state !== 'available';
}

/* ---- custom CSS: the file's name under the label, its full path on hover */
function customCss(value) {
  const hint = $('#css-file');
  const error = value?.error || '';
  hint.textContent = !value?.name ? 'None' : error ? `${value.name}, ${error[0].toLowerCase()}${error.slice(1)}` : value.name;
  hint.dataset.tone = error ? 'bad' : '';
  hint.title = value?.path || '';
  $('#css-reveal').hidden = !value?.path;
  $('#css-clear').hidden = !value?.path;
}

/* ---- recent runs */
const STYLE_NAMES = { normal: '', default: '' };
function runTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = ((total % 60000) / 1000).toFixed(3);
  return minutes ? `${minutes}:${seconds.padStart(6, '0')}` : seconds;
}
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
function when(at) {
  const date = new Date(at);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 864e5);
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : dayFormat.format(date);
  return `${day} ${timeFormat.format(date)}`;
}
async function refreshRuns() {
  const root = $('#runs');
  const runs = await api.listVault();
  root.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement('li');
    empty.className = 'runs-empty';
    empty.textContent = settings?.localRunVault === false ? 'Saving is off.' : 'Finished runs show up here.';
    root.append(empty);
    return;
  }
  for (const run of runs) {
    const row = document.createElement('li');
    const map = document.createElement('span');
    map.className = 'run-map';
    const name = document.createElement('b');
    name.textContent = run.mapName || run.mapId;
    const meta = document.createElement('span');
    const raw = run.style || 'normal';
    const style = STYLE_NAMES[raw] ?? `${raw[0].toUpperCase()}${raw.slice(1)}`;
    meta.textContent = [style, run.verified ? '' : 'not verified', when(run.savedAt)].filter(Boolean).join(', ');
    map.append(name, meta);
    const time = document.createElement('span');
    time.className = 'run-time';
    time.textContent = runTime(run.timeMs);
    if (run.personalBest) {
      const pb = document.createElement('span');
      pb.className = 'run-pb';
      pb.textContent = 'PB';
      time.prepend(pb);
    }
    const shot = document.createElement('span');
    shot.className = 'run-shot';
    if (run.hasScreenshot) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-ghost btn-sm';
      button.textContent = 'Screenshot';
      button.onclick = async () => {
        try {
          const image = await api.vaultScreenshot(run.id);
          if (!image.found) return show('That screenshot is gone.', 'bad');
          openViewer(`${name.textContent}  ${time.textContent.replace(/^PB/, '')}`, { image: `data:${image.mime};base64,${image.data}` });
        } catch (error) { show(error.message, 'bad'); }
      };
      shot.append(button);
    }
    row.append(map, time, shot);
    root.append(row);
  }
}

/* ---- benchmark */
const PROFILE_NAMES = { balanced: 'Balanced', competitive: 'Competitive', compatibility: 'Compatibility', custom: 'Custom' };
function benchState(value) {
  const button = $('#bench-start');
  button.disabled = !value?.ready || value?.running;
  button.textContent = value?.running ? 'Measuring' : 'Start';
  $('#bench-state').textContent = value?.running ? 'Keep playing until the game says it is done' : value?.ready ? '' : 'Open a map in the game first';
}
function benchResults(results) {
  const root = $('#bench');
  root.replaceChildren();
  for (const r of (Array.isArray(results) ? results : []).slice(0, 5)) {
    const row = document.createElement('li');
    const left = document.createElement('span');
    left.className = 'run-map';
    const name = document.createElement('b');
    name.textContent = r.map || 'Unknown map';
    const meta = document.createElement('span');
    const g = r.graphics || {};
    const l = r.launch || {};
    meta.textContent = [
      PROFILE_NAMES[l.profile] || '',
      g.width && g.height ? `${g.width}×${g.height}` : '',
      l.refreshHz ? `${l.refreshHz} Hz` : '',
      g.potato ? 'Potato' : '',
      g.uncapped ? 'Exceed monitor FPS' : '',
      l.uncap ? 'Browser uncapped' : '',
      `${r.hitches} ${r.hitches === 1 ? 'hitch' : 'hitches'}`,
      when(r.savedAt),
    ].filter(Boolean).join(', ');
    left.append(name, meta);
    const right = document.createElement('span');
    right.className = 'run-time';
    const fps = r.interval?.avg ? Math.round(1000 / r.interval.avg) : 0;
    const detail = document.createElement('small');
    detail.textContent = `p50 ${(r.interval?.p50 ?? 0).toFixed(2)} ms, p99 ${(r.interval?.p99 ?? 0).toFixed(2)} ms`;
    right.append(`${fps} FPS`, detail);
    row.append(left, right);
    root.append(row);
  }
}
$('#bench-start').onclick = async () => {
  try { await api.startBenchmark(); } catch (error) { show(error.message.replace(/^.*Error: /, ''), 'bad'); }
};
api.onBenchmarkState(benchState);
api.onBenchmarkResults((results) => { benchResults(results); show('Frame times saved.'); });

/* ---- viewer */
const viewer = $('#viewer');
function openViewer(title, { image = null, text = null }) {
  $('#viewer-title').textContent = title;
  const img = $('#run-image');
  img.hidden = !image;
  if (image) { img.src = image; img.alt = title; }
  $('#report').hidden = text === null;
  $('#report').textContent = text ?? '';
  viewer.showModal();
}
$('#viewer-close').onclick = () => viewer.close();
viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });

/* ---- actions */
const ACTIONS = {
  'open-vault': [() => api.openVault(), null],
  capture: [() => api.capture(), 'Screenshot saved.'],
  'export-report': [() => api.exportReport(), 'Report saved.'],
  'open-update': [() => api.openUpdate(), null],
  relaunch: [() => api.relaunch(), null],
  'css-choose': [() => api.chooseCustomCss(), null],
  'css-new': [() => api.newCustomCss(), null],
  'css-clear': [() => api.clearCustomCss(), null],
  'css-reveal': [() => api.revealCustomCss(), null],
};
for (const [id, [action, done]] of Object.entries(ACTIONS)) {
  $(`#${id}`).onclick = async () => {
    try {
      const result = await action();
      if (result?.customCss) customCss(result.customCss);
      if (result?.error) show(result.error, 'bad');
      else if (result?.saved !== false && done) show(done);
    } catch (error) { show(error.message, 'bad'); }
  };
}
$('#diagnostics').onclick = async () => {
  try { openViewer('Diagnostics', { text: JSON.stringify(await api.diagnostics(), null, 2) }); }
  catch (error) { show(error.message, 'bad'); }
};

api.onVaultChanged(() => refreshRuns().catch(error => show(error.message, 'bad')));
api.onDiscordStatus(discord);
api.onUpdateStatus(update);
api.onCustomCssStatus(customCss);

(async () => {
  try {
    const boot = await api.bootstrap();
    for (const display of boot.displays) {
      const option = document.createElement('option');
      option.value = `display:${display.id}`;
      option.textContent = `${display.label}${display.frequency ? `, ${display.frequency} Hz` : ''}`;
      $('#displays').append(option);
    }
    if (boot.version) $('#version').textContent = `v${boot.version}`;
    fill(boot.settings, boot.requiresRestart);
    discord(boot.discord);
    update(boot.update);
    customCss(boot.customCss);
    benchState(boot.benchmark);
    benchResults(boot.benchmark?.results);
    sizeTail();
    await refreshRuns();
  } catch (error) { show(`Settings unavailable: ${error.message}`, 'bad'); }
})();
