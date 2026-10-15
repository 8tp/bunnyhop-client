import os from 'node:os';
import { existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const output = path.resolve('dist', 'electron');
const directories = existsSync(output)
  ? readdirSync(output, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  : [];

let executable;
if (process.platform === 'darwin') {
  // electron-builder names the x64 build plain "mac"; prefer this machine's architecture.
  const directory = directories.find((name) => name === (process.arch === 'x64' ? 'mac' : `mac-${process.arch}`))
    ?? directories.find((name) => name === 'mac' || name.startsWith('mac-'));
  if (directory) executable = path.join(output, directory, 'Bunnyhop.app', 'Contents', 'MacOS', 'Bunnyhop');
} else if (process.platform === 'win32') {
  executable = path.join(output, 'win-unpacked', 'Bunnyhop.exe');
} else {
  executable = path.join(output, 'linux-unpacked', 'bunnyhop');
}

if (!executable || !existsSync(executable)) {
  throw new Error(`packaged Electron executable was not found under ${output}`);
}

delete process.env.ELECTRON_RUN_AS_NODE;
// Keep automated developer builds out of the user's login keychain. This
// switch is confined to smoke launchers and their disposable profiles.
const testKeychainArgs = process.platform === 'darwin' ? ['--use-mock-keychain'] : [];
const child = spawn(executable, testKeychainArgs, {
  env: {
    ...process.env,
    BUNNYHOP_SMOKE: process.env.BUNNYHOP_SMOKE || '1',
    BUNNYHOP_SETTINGS_FILE: path.join(mkdtempSync(path.join(os.tmpdir(),'bunnyhop-packaged-smoke-')), 'settings.json'),
    BUNNYHOP_DISABLE_UPDATES: '1',
  },
  stdio: 'inherit',
  windowsHide: true,
});
const timer = setTimeout(() => {
  console.error('Packaged Electron smoke test timed out');
  child.kill();
  process.exitCode = 1;
}, 30_000);
child.once('error', (error) => {
  clearTimeout(timer);
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  clearTimeout(timer);
  if (signal) console.error(`Packaged Electron smoke test ended with ${signal}`);
  process.exitCode = code ?? 1;
});
