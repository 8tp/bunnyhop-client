/* ============================================================
   BUNNYHOP CLIENT — GPU report.

   `npx electron client/electron/gpu-report.mjs` prints, as JSON, what
   chrome://gpu would show for THIS machine with THIS switch set: the
   feature status table (gpu_compositing, webgl, rasterization,
   video_decode, ...) and the basic GPU info (vendor/device ids, driver,
   active GPU). A player pastes it into a report; we see whether they
   are on the real GPU or on SwiftShader before anyone argues about fps.

   Same switches as the shell, so the report describes the shell.
   Nothing is opened, nothing is loaded; the process exits when done.
   ============================================================ */

import { app, BrowserWindow } from 'electron';
import process from 'node:process';

import { buildFlags } from './policy.mjs';

const flags = buildFlags({
  uncap: process.argv.includes('--uncap'),
  preferDiscreteGpu: !process.argv.includes('--no-discrete-gpu'),
});
for (const raw of flags) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(raw);
  if (!m) continue;
  if (m[2] === undefined) app.commandLine.appendSwitch(m[1]);
  else app.commandLine.appendSwitch(m[1], m[2]);
}

app.whenReady().then(async () => {
  const probe = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await probe.loadURL('about:blank');
  await new Promise((resolve) => setTimeout(resolve, 250));
  const out = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${process.arch}`,
    switches: flags,
    /* The chrome://gpu "Graphics Feature Status" table, as an object. */
    featureStatus: app.getGPUFeatureStatus(),
    /* 'basic' is fast and synchronous-ish; 'complete' also works but on
       Windows spawns a helper and takes a second or two. */
    gpu: await app.getGPUInfo('complete'),
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  probe.destroy();
  app.quit();
});
