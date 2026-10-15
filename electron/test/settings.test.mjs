import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlags } from '../policy.mjs';
import { SETTINGS_VERSION, applyPreset, resolveLaunchSettings, sanitizeSettings } from '../settings.mjs';

test('a saved version 1 Competitive profile moves off the browser-wide uncap', () => {
  const v1 = { version: 1, profile: 'competitive', windowMode: 'fullscreen', uncap: true, gpuTweaks: true, processPriority: 'high', discordRichPresence: true };
  const s = sanitizeSettings(v1);
  assert.equal(s.version, SETTINGS_VERSION);
  assert.equal(s.uncap, false);
  assert.equal(s.processPriority, 'above-normal');
  assert.equal(s.preferDiscreteGpu, true);
  assert.equal('gpuTweaks' in s, false);
  assert.equal(s.discordRichPresence, true);
  assert.deepEqual(buildFlags(s), ['--force_high_performance_gpu']);
});

test('a version 1 custom uncap is the player\'s choice and survives', () => {
  const s = sanitizeSettings({ version: 1, profile: 'custom', uncap: true, gpuTweaks: false, processPriority: 'high' });
  assert.equal(s.uncap, true);
  assert.equal(s.processPriority, 'above-normal');
  assert.deepEqual(buildFlags(s), ['--disable-frame-rate-limit', '--disable-gpu-vsync', '--force_high_performance_gpu']);
});

test('current settings are not migrated again, and High priority is gone', () => {
  const s = sanitizeSettings({ version: SETTINGS_VERSION, profile: 'competitive', uncap: true, processPriority: 'high' });
  assert.equal(s.uncap, true);
  assert.equal(s.processPriority, 'normal');
});

test('profiles: no uncap anywhere, Competitive raises priority, Compatibility adds no flags', () => {
  assert.equal(applyPreset({}, 'competitive').processPriority, 'above-normal');
  assert.equal(applyPreset({}, 'balanced').processPriority, 'normal');
  assert.deepEqual(buildFlags(applyPreset({}, 'compatibility')), []);
  assert.deepEqual(buildFlags({ gpuBackend: 'd3d11', pinDeviceScale: true }), ['--use-angle=d3d11', '--force-device-scale-factor=1']);
});

test('command-line overrides apply for one launch', () => {
  const saved = sanitizeSettings();
  const launch = resolveLaunchSettings(saved, { uncap: true, preferDiscreteGpu: false });
  assert.equal(launch.uncap, true);
  assert.equal(launch.preferDiscreteGpu, false);
  assert.equal(saved.uncap, false);
});

test('Discord presence is on by default and turned on once for older files', () => {
  assert.equal(sanitizeSettings().discordRichPresence, true);
  assert.equal(sanitizeSettings({ version: 2, discordRichPresence: false, privacyMode: false }).discordRichPresence, true);
  assert.equal(sanitizeSettings({ version: 2, discordRichPresence: false, privacyMode: true }).privacyMode, true);
  assert.equal(sanitizeSettings({ version: 2, profile: 'competitive', uncap: true }).uncap, true);
  assert.equal(sanitizeSettings({ version: SETTINGS_VERSION, discordRichPresence: false }).discordRichPresence, false);
});
