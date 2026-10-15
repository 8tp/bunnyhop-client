import { sanitizeWindowBounds } from './window-state.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SETTINGS_VERSION = 3;

export const PROFILE_NAMES = Object.freeze(['competitive', 'balanced', 'compatibility', 'custom']);
export const WINDOW_MODES = Object.freeze(['fullscreen', 'kiosk', 'windowed']);
export const GPU_BACKENDS = Object.freeze(['auto', 'd3d11', 'vulkan', 'opengl']);
export const PRIORITIES = Object.freeze(['normal', 'above-normal']);
export const BUNNYHOP_DISCORD_APPLICATION_ID = '1556467060916224040';

export const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  windowBounds: null,
  profile: 'balanced',
  windowMode: 'fullscreen',
  uncap: false,
  preferDiscreteGpu: true,
  gpuBackend: 'auto',
  pinDeviceScale: false,
  processPriority: 'normal',
  preferredDisplay: 'primary',
  preferHighestRefresh: false,
  localRunVault: true,
  capturePersonalBests: false,
  showDiagnosticsOnStart: false,
  updates: true,
  discordRichPresence: true,
  discordApplicationId: BUNNYHOP_DISCORD_APPLICATION_ID,
  discordShowMap: true,
  /* Discord Join: friends join your public server; private lobbies only if allowed too. */
  discordJoin: true,
  discordJoinLobbies: false,
  privacyMode: false,
});

/* No profile uncaps the browser (policy.mjs buildFlags): frames past the
   refresh rate come from the game's own Exceed monitor FPS setting. */
export const PRESETS = Object.freeze({
  competitive: Object.freeze({
    profile: 'competitive',
    windowMode: 'fullscreen',
    uncap: false,
    preferDiscreteGpu: true,
    gpuBackend: 'auto',
    pinDeviceScale: false,
    processPriority: 'above-normal',
    preferHighestRefresh: true,
  }),
  balanced: Object.freeze({
    profile: 'balanced',
    windowMode: 'fullscreen',
    uncap: false,
    preferDiscreteGpu: true,
    gpuBackend: 'auto',
    pinDeviceScale: false,
    processPriority: 'normal',
    preferHighestRefresh: true,
  }),
  compatibility: Object.freeze({
    profile: 'compatibility',
    windowMode: 'windowed',
    uncap: false,
    preferDiscreteGpu: false,
    gpuBackend: 'auto',
    pinDeviceScale: false,
    processPriority: 'normal',
    preferHighestRefresh: false,
  }),
});

/* Version 1 Competitive uncapped the whole browser, raised only the main
   process to High, and set extra GPU flags; on a fast machine it ran worse
   than Balanced. A saved version 1 Competitive profile moves to the current
   one; High priority becomes Above normal; the old GPU flag set becomes the
   discrete GPU preference. */
function migrate(input) {
  if (!input || typeof input !== 'object' || Number(input.version) >= SETTINGS_VERSION) return input;
  const version = Number(input.version) || 1;
  let next = { ...input };
  if (version < 2) {
    if (next.processPriority === 'high') next.processPriority = 'above-normal';
    if (next.gpuTweaks === true) next.preferDiscreteGpu = true;
    delete next.gpuTweaks;
    if (next.profile === 'competitive') next = { ...next, ...PRESETS.competitive };
  }
  /* Discord presence became on by default in 0.1.1. Earlier files saved the
     old default (off) on every window close, so it is turned on once.
     Privacy mode still hides it. */
  if (version < 3) next.discordRichPresence = true;
  return next;
}

function oneOf(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function display(value) {
  if (value === 'primary' || value === 'highest-refresh') return value;
  return /^display:-?\d{1,20}$/.test(String(value)) ? String(value) : 'primary';
}

/** Ignore unknown keys and invalid values. Settings are data, never flags. */
export function sanitizeSettings(raw = {}) {
  const base = DEFAULT_SETTINGS;
  const input = migrate(raw) ?? {};
  return {
    version: SETTINGS_VERSION,
    windowBounds: sanitizeWindowBounds(input.windowBounds),
    profile: oneOf(input.profile, PROFILE_NAMES, base.profile),
    windowMode: oneOf(input.windowMode, WINDOW_MODES, base.windowMode),
    uncap: bool(input.uncap, base.uncap),
    preferDiscreteGpu: bool(input.preferDiscreteGpu, base.preferDiscreteGpu),
    gpuBackend: oneOf(input.gpuBackend, GPU_BACKENDS, base.gpuBackend),
    pinDeviceScale: bool(input.pinDeviceScale, base.pinDeviceScale),
    processPriority: oneOf(input.processPriority, PRIORITIES, base.processPriority),
    preferredDisplay: display(input.preferredDisplay),
    preferHighestRefresh: bool(input.preferHighestRefresh, base.preferHighestRefresh),
    localRunVault: bool(input.localRunVault, base.localRunVault),
    capturePersonalBests: bool(input.capturePersonalBests, base.capturePersonalBests),
    showDiagnosticsOnStart: bool(input.showDiagnosticsOnStart, base.showDiagnosticsOnStart),
    updates: bool(input.updates, base.updates),
    discordRichPresence: bool(input.discordRichPresence, base.discordRichPresence),
    discordApplicationId: /^\d{17,20}$/.test(String(input.discordApplicationId || '')) ? String(input.discordApplicationId) : BUNNYHOP_DISCORD_APPLICATION_ID,
    discordShowMap: bool(input.discordShowMap, base.discordShowMap),
    discordJoin: bool(input.discordJoin, base.discordJoin),
    discordJoinLobbies: bool(input.discordJoinLobbies, base.discordJoinLobbies),
    privacyMode: bool(input.privacyMode, base.privacyMode),
  };
}

export function applyPreset(settings, profile) {
  if (!Object.hasOwn(PRESETS, profile)) throw new Error(`unknown profile ${profile}`);
  return sanitizeSettings({ ...sanitizeSettings(settings), ...PRESETS[profile] });
}

export function defaultSettingsPath({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  if (platform === 'win32') {
    return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Bunnyhop', 'client-settings.json');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Bunnyhop', 'client-settings.json');
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'bunnyhop', 'client-settings.json');
}

export function loadSettings(file = defaultSettingsPath()) {
  if (!existsSync(file)) return sanitizeSettings();
  try {
    return sanitizeSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return sanitizeSettings();
  }
}

export function saveSettings(file, input) {
  const settings = sanitizeSettings(input);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  return settings;
}

/** CLI values are explicit overrides. Null means use the saved setting. */
export function resolveLaunchSettings(saved, overrides = {}) {
  const settings = sanitizeSettings(saved);
  const windowMode = overrides.windowMode ?? settings.windowMode;
  return {
    ...settings,
    windowMode,
    uncap: overrides.uncap ?? settings.uncap,
    preferDiscreteGpu: overrides.preferDiscreteGpu ?? settings.preferDiscreteGpu,
    gpuBackend: overrides.gpuBackend ?? settings.gpuBackend,
    pinDeviceScale: overrides.pinDeviceScale ?? settings.pinDeviceScale,
    processPriority: overrides.processPriority ?? settings.processPriority,
  };
}
