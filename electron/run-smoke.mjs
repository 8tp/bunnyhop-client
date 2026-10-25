import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const cli = path.resolve('node_modules', 'electron', 'cli.js');
delete process.env.ELECTRON_RUN_AS_NODE;
// Test profiles contain no real account credentials. Electron's own macOS
// tests use this switch so unsigned rebuilds never request the login keychain.
const testKeychainArgs = process.platform === 'darwin' ? ['--use-mock-keychain'] : [];
const profile = mkdtempSync(path.join(os.tmpdir(),'bunnyhop-smoke-'));
const settingsFile = path.join(profile, 'settings.json');
/* A custom CSS file chosen already, so the smoke run can check it reaches the game and follows saves. */
const customCssFile = path.join(profile, 'smoke.css');
writeFileSync(customCssFile, '.smoke{}');
writeFileSync(settingsFile, `${JSON.stringify({ version: 3, customCssPath: customCssFile })}\n`);
const child = spawn(process.execPath, [cli, '.', '--windowed', ...testKeychainArgs], {
  env: {
    ...process.env,
    BUNNYHOP_SMOKE: process.env.BUNNYHOP_SMOKE || '1',
    BUNNYHOP_SETTINGS_FILE: settingsFile,
    BUNNYHOP_DISABLE_UPDATES: '1',
  },
  stdio: 'inherit',
  windowsHide: true,
});
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) console.error(`Electron smoke test ended with ${signal}`);
  process.exitCode = code ?? 1;
});
