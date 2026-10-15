import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  dialog,
  ipcMain,
  net,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CLIENT_HEADER,
  CLIENT_NAME,
  GAME_ORIGINS,
  buildFlags,
  gameUrl,
  isAllowedNavigation,
  isAllowedSubframe,
  isGameUrl,
  isSafeExternal,
} from './policy.mjs';
import {
  applyPreset,
  defaultSettingsPath,
  loadSettings,
  resolveLaunchSettings,
  saveSettings,
} from './settings.mjs';
import { ContentCache } from './content-cache.mjs';
import { coalescedWriter } from './coalesced-writer.mjs';
import { restoreWindowBounds, settingsAfterWindowClose, settingsAfterFullscreenAction } from './window-state.mjs';
import { chooseDisplay, collectDiagnostics, publicDisplays } from './diagnostics.mjs';
import { DiscordPresence, PRESENCE_KINDS, PRESENCE_MODES, buildPresenceActivity } from './discord-rpc.mjs';
import { applyWindowsAppIdentity } from './branding.mjs';
import {
  deepLinkTarget,
  downloadDecision,
  isArchivableRun,
  sanitizeRunSummary,
  settingsAssetName,
  SETTINGS_ASSET_TYPES,
} from './security.mjs';
import { PersonalBestCapture, RunVault } from './run-vault.mjs';
import { applyPriority } from './process-priority.mjs';
import { checkForUpdate, isReleasePage } from './update-check.mjs';
import { installSmokeFixture, runSmoke } from './smoke.mjs';

/* Only release builds (npm run release:build) carry bunnyhopReleaseBuild in
   their packaged package.json. They check for new versions and never run
   the smoke harness, whatever the environment says. */
function isReleaseBuild() {
  try {
    return JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).bunnyhopReleaseBuild === true;
  } catch {
    return false;
  }
}
const releaseBuild = isReleaseBuild();
const smoke = !releaseBuild && process.env.BUNNYHOP_SMOKE ? process.env.BUNNYHOP_SMOKE : null;
app.setName('Bunnyhop');
app.setPath('userData', smoke && process.env.BUNNYHOP_SETTINGS_FILE ? path.join(path.dirname(process.env.BUNNYHOP_SETTINGS_FILE), 'profile') : path.join(app.getPath('appData'), 'Bunnyhop'));
const here = path.dirname(fileURLToPath(import.meta.url));
const settingsRoot = path.join(here, 'settings');
const settingsUrl = 'bunnyhop-settings://app/index.html';
const settingsFile = process.env.BUNNYHOP_SETTINGS_FILE || defaultSettingsPath();
const vaultRoot = path.join(path.dirname(settingsFile), 'vault');
const captureVault = path.join(vaultRoot, 'captures');
const reportVault = path.join(vaultRoot, 'reports');
const runVault = new RunVault(vaultRoot);
const contentCache = new ContentCache(path.join(app.getPath('userData'), 'content-cache'));
/* The web app's page ground (index.html theme-color, --ground in its
   tokens), so a window never flashes a different black before the first
   paint. The settings sheet is drawn on the same ground. */
const GAME_BACKGROUND = '#101318';
const RESTART_KEYS = Object.freeze([
  'windowMode', 'uncap', 'preferDiscreteGpu', 'gpuBackend', 'pinDeviceScale',
  'processPriority', 'preferredDisplay', 'preferHighestRefresh',
]);
const UPDATE_CHECK_DELAY = 20_000;
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

protocol.registerSchemesAsPrivileged([{
  scheme: 'bunnyhop-settings',
  privileges: { standard: true, secure: true },
}]);

function cliOverrides(argv = process.argv.slice(1)) {
  const has = (value) => argv.includes(value);
  let windowMode = null;
  if (has('--windowed')) windowMode = 'windowed';
  else if (has('--kiosk')) windowMode = 'kiosk';
  else if (has('--fullscreen')) windowMode = 'fullscreen';
  return {
    windowMode,
    uncap: has('--no-uncap') ? false : (has('--uncap') ? true : null),
    preferDiscreteGpu: has('--no-discrete-gpu') ? false : (has('--discrete-gpu') ? true : null),
  };
}

const environmentDiscordId = String(process.env.BUNNYHOP_DISCORD_APP_ID || '');
const runtimeDiscordId = /^\d{17,20}$/.test(environmentDiscordId) ? environmentDiscordId : null;
const withRuntimeOverrides = (settings) => runtimeDiscordId
  ? { ...settings, discordApplicationId: runtimeDiscordId }
  : settings;
/* currentSettings is what the settings file holds and the F10 window edits.
   startupSettings is what this launch runs with: the file plus one-off
   command-line overrides, which must never be written back to the file.
   launchSettings is the file as it was at launch, the baseline for
   "relaunch pending". */
let currentSettings = withRuntimeOverrides(loadSettings(settingsFile));
const launchSettings = currentSettings;
let windowPreferenceMode = launchSettings.windowMode;
const startupSettings = resolveLaunchSettings(currentSettings, cliOverrides());

for (const raw of buildFlags(startupSettings)) {
  const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
  if (!match) continue;
  app.commandLine.appendSwitch(match[1], match[2]);
}

applyWindowsAppIdentity(app);
app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();

const version = app.getVersion();
const clientValue = `${CLIENT_NAME}/${version}`.slice(0, 32);
app.userAgentFallback = `${app.userAgentFallback} BunnyhopClient/${version}`;

let gameWindow = null;
let settingsWindow = null;
let discordClient = null;
let discordStatus = { state: 'disabled' };
let presenceTimer = null;
let pendingPresence = { kind: 'menu', startedAt: Math.floor(Date.now() / 1000) };
let lastPresenceAt = 0;
const localStatusWriter = coalescedWriter(raw => { try { writeLocalStatus(raw); } catch(error) {console.warn('[client] local status write failed',error.message);} });
let lastRunArchiveAt = 0;
let pendingDeepLinkTarget = null;
let updateStatus = { state: 'disabled' };
let notifiedUpdate = null;
const resultCapture = new PersonalBestCapture({
  capture: async () => {
    if (!gameWindow || gameWindow.isDestroyed()) return null;
    return (await gameWindow.capturePage()).toPNG();
  },
  save: (id, png) => runVault.attachScreenshot(id, png),
  onSaved: () => settingsWindow?.webContents.send('vault:changed'),
  onError: (error) => console.warn('[client] PB screenshot failed', error.message),
});

function safeOrigin(url) {
  try { return new URL(url).origin; } catch { return ''; }
}

function isSettingsUrl(url) {
  return url === settingsUrl;
}

function requireSettingsSender(event) {
  if (!settingsWindow || event.sender !== settingsWindow.webContents || event.senderFrame !== event.sender.mainFrame || !isSettingsUrl(event.senderFrame?.url || event.sender.getURL())) throw new Error('settings IPC sender refused');
}

/* Only the main game window speaks for the player. A game page opened in a
   child window (a replay, the privacy page) may inherit the preload; its
   presence, stats and run summaries are refused here all the same. */
function requireGameSender(event) {
  if (!gameWindow || gameWindow.isDestroyed() || event.sender !== gameWindow.webContents) {
    throw new Error('game IPC sender refused');
  }
  if (event.senderFrame !== event.sender.mainFrame || !isGameUrl(event.senderFrame?.url || event.sender.getURL())) throw new Error('game IPC sender refused');
}

function publicClientSettings() {
  return Object.freeze({
    profile: currentSettings.profile,
    localRunVault: currentSettings.localRunVault,
    discordRichPresence: currentSettings.discordRichPresence && !currentSettings.privacyMode,
    discordShowMap: currentSettings.discordShowMap && !currentSettings.privacyMode,
    privacyMode: currentSettings.privacyMode,
    /* Chromium's own frame limit is off for this launch (the experimental
       uncap). The game can then gate its requestAnimationFrame loop on the
       GPU, as its own uncapped loop already does. */
    browserUncapped: startupSettings.uncap,
  });
}

function needsRestart(settings = currentSettings) {
  return RESTART_KEYS.some((key) => settings[key] !== launchSettings[key]);
}

function openExternal(url) {
  if (!isSafeExternal(url) || isGameUrl(url)) return;
  shell.openExternal(url).catch((error) => console.warn('[client] external open failed', error.message));
}

function guardNavigation(event, url) {
  if (isAllowedNavigation(url) || isSettingsUrl(url)) return;
  event.preventDefault();
  openExternal(url);
  console.warn('[client] blocked navigation to', url);
}

function ensureVaults() {
  for (const directory of [vaultRoot, captureVault, reportVault]) mkdirSync(directory, { recursive: true });
  runVault.ensure();
}

function timestampName(prefix, extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}.${extension}`;
}

function archiveRunSummary(raw) {
  if (!currentSettings.localRunVault) return { saved: false, reason: 'disabled' };
  const now = Date.now();
  if (now - lastRunArchiveAt < 1_000) throw new Error('run archive rate limit');
  lastRunArchiveAt = now;
  const summary = sanitizeRunSummary(raw, { client: clientValue });
  if (!summary.mapId) throw new Error('run summary is missing a map');
  if (!isArchivableRun(summary)) return { saved: false, reason: 'draft' };
  ensureVaults();
  const archived = runVault.archive(summary, { client: clientValue });
  settingsWindow?.webContents.send('vault:changed');
  if (pendingPresence.kind === 'results') schedulePersonalBestCapture(archived);
  return { saved: true, id: archived.id, screenshotPending: resultCapture.pendingId === archived.id };
}

function selectedDisplay() {
  return chooseDisplay(screen.getAllDisplays(), startupSettings, screen.getPrimaryDisplay());
}

function createGameWindow() {
  const display = selectedDisplay();
  const bounds = display?.bounds || { x: 0, y: 0, width: 1600, height: 900 };
  const windowMode = startupSettings.windowMode;
  const restored = restoreWindowBounds(currentSettings.windowBounds,screen.getAllDisplays(),display);
  const win = new BrowserWindow({
    x: windowMode === 'windowed' ? restored.x : bounds.x,
    y: windowMode === 'windowed' ? restored.y : bounds.y,
    width: windowMode === 'windowed' ? restored.width : bounds.width,
    height: windowMode === 'windowed' ? restored.height : bounds.height,
    backgroundColor: GAME_BACKGROUND,
    autoHideMenuBar: true,
    fullscreen: windowMode === 'fullscreen',
    kiosk: windowMode === 'kiosk',
    title: 'Bunnyhop',
    show: !smoke,
    webPreferences: {
      preload: path.join(here, 'game-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: true,
      webviewTag: false,
      spellcheck: false,
      safeDialogs: true,
    },
  });
  gameWindow = win;
  const rememberWindow = () => {
    if (smoke || win.isDestroyed()) return;
    currentSettings = withRuntimeOverrides(saveSettings(settingsFile,settingsAfterWindowClose(currentSettings,win.getNormalBounds())));
  };
  win.on('close',rememberWindow);
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) { cancelPendingResultCapture(); queuePresence({kind:'menu'}); }
  });
  if (smoke) runSmoke({ app, win, mode: smoke, createSettingsWindow });
  win.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
    if (!mainFrame || code === -3 || smoke || !isAllowedNavigation(url)) return;
    const html = '<!doctype html><meta charset=utf-8><meta http-equiv=Content-Security-Policy content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{background:#101318;color:#e6e9ef;font:18px system-ui;padding:12vh 12vw}a{color:#ffb43a}</style><h1>Bunnyhop could not load.</h1><p>Check your connection, then try again.</p><p><a href="https://bunnyhop.lol/">Retry Bunnyhop</a></p><p>F10 opens client settings and diagnostics.</p>';
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(()=>{});
    console.warn('[client] game load failed', code, description);
  });
  win.webContents.on('render-process-gone', () => { cancelPendingResultCapture(); queuePresence({kind:'menu'}); dialog.showMessageBox(win,{type:'error',message:'The game stopped unexpectedly.',buttons:['Reload game','Close'],defaultId:0}).then(({response}) => response===0 ? win.loadURL(gameUrl({client:clientValue})).catch(()=>{}) : win.close()); });
  win.webContents.on('did-finish-load', raiseProcessPriority);
  win.on('closed', () => { if (gameWindow === win) gameWindow = null; });
  win.loadURL(gameUrl({
    client: clientValue,
  })).catch(() => {});
  return win;
}

function setGameFullscreen(fullscreen) {
  if (!gameWindow || gameWindow.isDestroyed() || gameWindow.isKiosk()) return;
  if (!smoke) {
    const next = settingsAfterFullscreenAction(currentSettings,{fullscreen,launchMode:windowPreferenceMode,cliMode:cliOverrides().windowMode});
    if (next !== currentSettings) { currentSettings = withRuntimeOverrides(saveSettings(settingsFile,next)); windowPreferenceMode = next.windowMode; }
  }
  gameWindow.setFullScreen(fullscreen);
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }
  settingsWindow = new BrowserWindow({
    width: 1040,
    height: 860,
    minWidth: 700,
    minHeight: 640,
    /* --ground in electron/settings/settings.css, the game's ground. */
    backgroundColor: GAME_BACKGROUND,
    title: 'Bunnyhop Client Settings',
    autoHideMenuBar: true,
    show: !smoke,
    webPreferences: {
      preload: path.join(here, 'settings-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
  settingsWindow.loadURL(settingsUrl).catch((error) => {
    console.warn('[client] settings page failed to load', error.message);
  });
  return settingsWindow;
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => guardNavigation(event, url));
  contents.on('will-redirect', (event, url) => guardNavigation(event, url));
  contents.setWindowOpenHandler(({ url }) => {
    /* A game link that asks for a new tab (watch a duel replay, a share
       link, the privacy page) opens in a sandboxed child window, so a live
       game in the main window is never navigated away. */
    if (isAllowedNavigation(url) && isAllowedNavigation(contents.getURL())) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 800,
          backgroundColor: GAME_BACKGROUND,
          autoHideMenuBar: true,
          title: 'Bunnyhop',
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F10') {
      createSettingsWindow();
      event.preventDefault();
      return;
    }
    if (input.key === 'F9' && gameWindow) {
      captureGameWindow().catch((error) => console.warn('[client] capture failed', error.message));
      event.preventDefault();
      return;
    }
    if (input.key !== 'F11') return;
    const win = BrowserWindow.fromWebContents(contents);
    if (win === gameWindow && startupSettings.windowMode !== 'kiosk') setGameFullscreen(!win.isFullScreen());
    event.preventDefault();
  });
});

function configureDownloads(ses) {
  ses.on('will-download', (event, item, contents) => {
    const decision = downloadDecision({
      pageUrl: contents?.getURL?.() || '',
      downloadUrl: item.getURL(),
      filename: item.getFilename(),
    });
    if (!decision) {
      event.preventDefault();
      console.warn('[client] blocked download', item.getFilename());
      return;
    }
    /* No save path: Chromium shows the save dialog, so the player chooses
       every file that lands on disk. */
    item.setSaveDialogOptions({
      title: 'Save from Bunnyhop',
      defaultPath: path.join(app.getPath('downloads'), decision.filename),
      filters: [decision.filter],
    });
  });
}

function configureSession(ses) {
  configureDownloads(ses);
  /* clipboard-sanitized-write lets "Copy image" on a player card put a PNG
     on the clipboard. Reading the clipboard stays denied. */
  const allowedPermissions = new Set(['pointerLock', 'fullscreen', 'keyboardLock', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = safeOrigin(details?.requestingUrl || details?.securityOrigin || contents.getURL());
    callback(GAME_ORIGINS.includes(origin) && allowedPermissions.has(permission));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return GAME_ORIGINS.includes(safeOrigin(requestingOrigin)) && allowedPermissions.has(permission);
  });
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (settingsAssetName(details.url)) return callback({});
    if (details.url.startsWith('file:')) return callback({ cancel: true });
    if (details.resourceType === 'mainFrame' && !isAllowedNavigation(details.url)) return callback({ cancel: true });
    if (details.resourceType === 'subFrame' && !isAllowedSubframe(details.url)) return callback({ cancel: true });
    callback({});
  });
  ses.webRequest.onBeforeSendHeaders({ urls: GAME_ORIGINS.map((origin) => `${origin}/*`) }, (details, callback) => {
    details.requestHeaders[CLIENT_HEADER] = version;
    callback({ requestHeaders: details.requestHeaders });
  });
}

function configureSettingsProtocol() {
  protocol.handle('bunnyhop-settings', (request) => {
    const name = settingsAssetName(request.url);
    if (!name) return new Response('Not found', { status: 404 });
    try {
      return new Response(readFileSync(path.join(settingsRoot, name)), {
        status: 200,
        headers: {
          'Content-Type': SETTINGS_ASSET_TYPES[name],
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/* The browser, GPU and game renderer processes, each by pid (Windows only).
   Rerun after every game load and GPU restart: a new process starts at
   Normal. */
function raiseProcessPriority() {
  const gamePid = gameWindow && !gameWindow.isDestroyed() ? gameWindow.webContents.getOSProcessId() : 0;
  applyPriority({ priority: startupSettings.processPriority, metrics: app.getAppMetrics(), gamePid });
}

/* A notice, not an installer (update-check.mjs). The setting is read at
   each check, so turning it off in F10 applies at once. */
function configureUpdates() {
  if (!app.isPackaged || !releaseBuild || process.env.BUNNYHOP_DISABLE_UPDATES === '1') return;
  const run = async () => {
    if (!currentSettings.updates) return;
    updateStatus = await checkForUpdate({ fetch: net.fetch, currentVersion: version });
    if (updateStatus.state === 'error') console.warn('[client] update check failed', updateStatus.message);
    settingsWindow?.webContents.send('update:status', updateStatus);
    notifyUpdate();
  };
  setTimeout(run, UPDATE_CHECK_DELAY);
  setInterval(run, UPDATE_CHECK_INTERVAL);
}

function openUpdatePage() {
  if (updateStatus.state !== 'available' || !isReleasePage(updateStatus.page)) return { opened: false };
  shell.openExternal(updateStatus.page).catch((error) => console.warn('[client] external open failed', error.message));
  return { opened: true };
}

/* Once per version, and never during a run: it waits for the next menu or
   results screen. */
function notifyUpdate() {
  if (updateStatus.state !== 'available' || notifiedUpdate === updateStatus.version || pendingPresence.kind === 'playing') return;
  if (!Notification.isSupported()) return;
  notifiedUpdate = updateStatus.version;
  const notice = new Notification({ title: `Bunnyhop ${updateStatus.version} is available`, body: 'Click to open the download page. F10 → Client has it too.' });
  notice.on('click', openUpdatePage);
  notice.show();
}

function stopDiscord() {
  clearTimeout(presenceTimer);
  presenceTimer = null;
  const oldClient = discordClient;
  discordClient = null;
  oldClient?.stop();
  discordStatus = { state: 'disabled' };
  settingsWindow?.webContents.send('discord:status', discordStatus);
}

function cancelPendingResultCapture() {
  resultCapture.cancel();
}

function schedulePersonalBestCapture(summary) {
  resultCapture.schedule(summary, {
    enabled: currentSettings.localRunVault && currentSettings.capturePersonalBests,
  });
}

function writeLocalStatus(raw) {
  ensureVaults();
  const activity = buildPresenceActivity(raw, currentSettings);
  const status = {
    version: 1,
    updatedAt: new Date().toISOString(),
    kind: PRESENCE_KINDS.includes(raw?.kind) ? raw.kind : 'menu',
    mode: PRESENCE_MODES.includes(raw?.mode) ? raw.mode : 'solo',
    details: activity.details,
    state: activity.state,
  };
  const target = path.join(vaultRoot, 'status.json');
  const temporary = path.join(vaultRoot, '.status.json.tmp');
  writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
}

async function configureDiscord() {
  stopDiscord();
  // A smoke run never shows up on the developer's own Discord.
  if (smoke || !currentSettings.discordRichPresence || currentSettings.privacyMode) return;
  if (!currentSettings.discordApplicationId) {
    discordStatus = { state: 'missing-application-id' };
    settingsWindow?.webContents.send('discord:status', discordStatus);
    return;
  }
  const client = new DiscordPresence(currentSettings.discordApplicationId);
  discordClient = client;
  client.on('status', (status) => {
    if (discordClient !== client) return;
    discordStatus = status;
    settingsWindow?.webContents.send('discord:status', status);
  });
  client.on('error', (error) => {
    if (discordClient !== client) return;
    discordStatus = { state: 'error', message: error.message };
    settingsWindow?.webContents.send('discord:status', discordStatus);
    console.warn('[client] Discord Rich Presence unavailable', error.message);
  });
  await client.start();
  queuePresence(pendingPresence, true);
}

function queuePresence(raw, immediate = false) {
  pendingPresence = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { kind: 'menu' };
  if (pendingPresence.kind !== 'results') cancelPendingResultCapture();
  localStatusWriter.update(pendingPresence);
  notifyUpdate();
  if (!discordClient) return;
  clearTimeout(presenceTimer);
  const wait = immediate ? 0 : Math.max(0, 15_000 - (Date.now() - lastPresenceAt));
  presenceTimer = setTimeout(() => {
    lastPresenceAt = Date.now();
    discordClient?.setActivity(buildPresenceActivity(pendingPresence, currentSettings));
  }, wait);
}

async function diagnostics() {
  const report = await collectDiagnostics({ app, screen, settings: currentSettings });
  return { ...report, discord: discordStatus, requiresRestart: needsRestart() };
}

async function exportReport() {
  ensureVaults();
  const suggested = path.join(reportVault, timestampName('bunnyhop-support', 'json'));
  const result = await dialog.showSaveDialog(settingsWindow || gameWindow, {
    title: 'Export Bunnyhop support report',
    defaultPath: suggested,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  writeFileSync(result.filePath, `${JSON.stringify(await diagnostics(), null, 2)}\n`, { mode: 0o600 });
  return { saved: true };
}

async function captureGameWindow() {
  if (!gameWindow || gameWindow.isDestroyed()) return { saved: false, reason: 'game-window-unavailable' };
  ensureVaults();
  const image = await gameWindow.capturePage();
  const suggested = path.join(captureVault, timestampName('bunnyhop', 'png'));
  const result = await dialog.showSaveDialog(settingsWindow || gameWindow, {
    title: 'Save Bunnyhop screenshot',
    defaultPath: suggested,
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  writeFileSync(result.filePath, image.toPNG(), { mode: 0o600 });
  return { saved: true };
}

function listVaultRuns() {
  return runVault.list({ limit: 250 });
}

function loadVaultScreenshot(id) {
  const png = runVault.screenshot(id);
  if (!png) return { found: false };
  return { found: true, mime: 'image/png', data: png.toString('base64') };
}

function installIpc() {
  ipcMain.handle('settings:bootstrap', async (event) => {
    requireSettingsSender(event);
    return {
      settings: currentSettings,
      displays: publicDisplays(screen.getAllDisplays()),
      requiresRestart: needsRestart(),
      discord: discordStatus,
      update: updateStatus,
    };
  });
  ipcMain.handle('settings:save', async (event, raw) => {
    requireSettingsSender(event);
    currentSettings = withRuntimeOverrides(saveSettings(settingsFile, raw));
    if (!currentSettings.capturePersonalBests || !currentSettings.localRunVault) cancelPendingResultCapture();
    gameWindow?.webContents.send('client:settings', publicClientSettings());
    await configureDiscord();
    queuePresence(pendingPresence, true);
    return { settings: currentSettings, requiresRestart: needsRestart() };
  });
  ipcMain.handle('settings:apply-preset', (event, profile) => {
    requireSettingsSender(event);
    currentSettings = withRuntimeOverrides(saveSettings(settingsFile, applyPreset(currentSettings, profile)));
    gameWindow?.webContents.send('client:settings', publicClientSettings());
    return { settings: currentSettings, requiresRestart: needsRestart() };
  });
  ipcMain.handle('settings:diagnostics', (event) => { requireSettingsSender(event); return diagnostics(); });
  ipcMain.handle('settings:export-report', (event) => { requireSettingsSender(event); return exportReport(); });
  ipcMain.handle('settings:capture', (event) => { requireSettingsSender(event); return captureGameWindow(); });
  ipcMain.handle('settings:list-vault', (event) => { requireSettingsSender(event); return listVaultRuns(); });
  ipcMain.handle('settings:vault-screenshot', (event, id) => {
    requireSettingsSender(event);
    return loadVaultScreenshot(id);
  });
  ipcMain.handle('settings:open-vault', async (event) => {
    requireSettingsSender(event);
    ensureVaults();
    const error = await shell.openPath(vaultRoot);
    return { opened: error === '', error };
  });
  ipcMain.handle('settings:open-update', (event) => { requireSettingsSender(event); return openUpdatePage(); });
  ipcMain.handle('settings:relaunch', (event) => {
    requireSettingsSender(event);
    app.relaunch();
    app.quit();
    return { relaunching: true };
  });
  ipcMain.handle('client:fullscreen', (event, value) => { requireGameSender(event); if (typeof value !== 'boolean') throw new Error('invalid fullscreen'); setGameFullscreen(value); return gameWindow.isFullScreen(); });
  ipcMain.handle('client:open-settings', (event) => { requireGameSender(event); createSettingsWindow(); });
  ipcMain.handle('client:cache-get', (event, hash) => { requireGameSender(event); return contentCache.get(hash); });
  ipcMain.handle('client:cache-put', (event, hash, bytes) => { requireGameSender(event); return contentCache.put(hash, bytes); });
  ipcMain.handle('client:public-settings', (event) => { requireGameSender(event); return publicClientSettings(); });
  ipcMain.on('client:presence', (event, raw) => {
    try { requireGameSender(event); queuePresence(raw); } catch (error) { console.warn('[client] presence refused', error.message); }
  });
  ipcMain.on('client:result-settled', (event, archiveId) => {
    try { requireGameSender(event); if (archiveId === resultCapture.pendingId && pendingPresence.kind === 'results') resultCapture.settle(); } catch (error) { console.warn('[client] result settle refused', error.message); }
  });
  ipcMain.handle('client:save-run-summary', (event, raw) => {
    requireGameSender(event);
    return archiveRunSummary(raw);
  });
}

function navigateDeepLink(target) {
  if (!target || !gameWindow) return false;
  gameWindow.loadURL(gameUrl({
    url: target,
    client: clientValue,
  })).catch(() => {});
  gameWindow.show();
  gameWindow.focus();
  return true;
}

function handleDeepLink(argv) {
  const value = argv.find((arg) => arg.startsWith('bunnyhop://'));
  return navigateDeepLink(value && deepLinkTarget(value));
}

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  configureSettingsProtocol();
  configureSession(session.defaultSession);
  if (smoke && smoke !== 'live') installSmokeFixture(protocol);
  installIpc();
  ensureVaults();
  app.on('certificate-error', (_event, _contents, _url, _error, _certificate, callback) => callback(false));
  if (app.isPackaged && !smoke) app.setAsDefaultProtocolClient('bunnyhop');
  app.on('child-process-gone', (_event, details) => { if (details.type === 'GPU') setTimeout(raiseProcessPriority, 2_000); });

  createGameWindow();
  raiseProcessPriority();
  if (!smoke) configureUpdates();
  await configureDiscord();
  queuePresence(pendingPresence, true);

  if (currentSettings.showDiagnosticsOnStart || process.argv.includes('--settings')) createSettingsWindow();
  handleDeepLink(process.argv);
  if (pendingDeepLinkTarget) {
    navigateDeepLink(pendingDeepLinkTarget);
    pendingDeepLinkTarget = null;
  }

  app.on('second-instance', (_event, argv) => {
    if (handleDeepLink(argv)) return;
    if (!gameWindow) return;
    if (gameWindow.isMinimized()) gameWindow.restore();
    gameWindow.focus();
  });
  app.on('activate', () => {
    if (!gameWindow) createGameWindow();
  });
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  const target = deepLinkTarget(url);
  if (!target) return;
  if (app.isReady()) navigateDeepLink(target);
  else pendingDeepLinkTarget = target;
});
app.on('before-quit', () => {
  localStatusWriter.stop();
  cancelPendingResultCapture();
  stopDiscord();
});
app.on('window-all-closed', () => app.quit());
