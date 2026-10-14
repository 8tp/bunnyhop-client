import { writeFileSync } from 'node:fs';

import { isGameUrl } from './policy.mjs';

/* Automated launch checks (npm run electron:smoke and
   electron:packaged-smoke). main.mjs runs them only when BUNNYHOP_SMOKE is
   set in a build without the release stamp, so a release never serves the
   fixture page below or runs these scripts. */

/** The fixture answers every game URL, so no smoke run touches the live site unless mode is 'live'. */
export function installSmokeFixture(protocol) {
  protocol.handle('https', request => {
    if (!isGameUrl(request.url)) return new Response('Refused',{status:403});
    return new Response('<!doctype html><title>Bunnyhop integration fixture</title><h1>Bunnyhop</h1>',{headers:{'Content-Type':'text/html'}});
  });
}

export function runSmoke({ app, win, mode, createSettingsWindow }) {
  const deadline = setTimeout(() => { process.stderr.write('electron smoke: timeout\n'); app.exit(1); }, 45000);
  win.webContents.once('dom-ready', async () => {
    try {
      const bridge = await win.webContents.executeJavaScript(`(async()=>{
        if (window.bunnyhopClient?.version !== 1) throw new Error('missing game bridge');
        const settings=await window.bunnyhopClient.getSettings();
        if (settings.discordRichPresence !== false) throw new Error('unexpected public settings');
        const cacheBytes = new Uint8Array([1,2,3]);
        const cacheHash = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
        if (!await window.bunnyhopClient.cacheContent(cacheHash, cacheBytes)) throw new Error('cache write failed');
        const cacheHit = await window.bunnyhopClient.getCachedContent(cacheHash);
        if (cacheHit?.length !== 3 || cacheHit[2] !== 3) throw new Error('cache IPC read failed');
        window.bunnyhopClient.setPresence({kind:'results',mapId:'bhop_smoke',mapName:'Smoke',mode:'solo'});
        const run=await window.bunnyhopClient.saveRunSummary({mapId:'bhop_smoke',mapName:'Smoke',timeMs:1234,ticks:158,tickRate:128,personalBest:true,verified:false,mode:'solo'});
        if (!run.saved || !run.id) throw new Error('vault archive failed');
        window.bunnyhopClient.resultSettled(run.id);
        return true;
      })()`);
      if (!bridge) throw new Error('game bridge failed');
      if (process.env.BUNNYHOP_SMOKE_GAME_SCREENSHOT) {
        await new Promise(resolve => setTimeout(resolve,3000));
        writeFileSync(process.env.BUNNYHOP_SMOKE_GAME_SCREENSHOT,(await win.capturePage()).toPNG());
      }
      if (mode !== 'live') {
        await win.loadURL('about:blank');
        const refused=await win.webContents.executeJavaScript(`window.bunnyhopClient.getSettings().then(()=>false,()=>true)`);
        if (!refused) throw new Error('untrusted origin gained IPC');
        const cacheRefused = await win.webContents.executeJavaScript(`window.bunnyhopClient.getCachedContent('a'.repeat(64)).then(()=>false,()=>true)`);
        if (!cacheRefused) throw new Error('untrusted origin gained cache access');
      }
      const settings = createSettingsWindow();
      settings.webContents.once('dom-ready', async () => {
        try {
          await settings.webContents.executeJavaScript(`(async()=>{
            if (!Object.isFrozen(window.bunnyhopSettings)) throw new Error('missing settings bridge');
            const b=await window.bunnyhopSettings.bootstrap();
            if(b.settings.profile!=='balanced') throw new Error('bad default profile');
            const runs=await window.bunnyhopSettings.listVault();
            if(!runs.some(r=>r.mapId==='bhop_smoke' && r.timeMs===1234 && r.verified===false)) throw new Error('archive not visible');
            if(!document.querySelector('#settings-form')) throw new Error('settings form absent');
          })()`);
          if (process.env.BUNNYHOP_SMOKE_SCREENSHOT) {
            await new Promise(resolve => setTimeout(resolve,500));
            writeFileSync(process.env.BUNNYHOP_SMOKE_SCREENSHOT,(await settings.capturePage()).toPNG());
          }
          clearTimeout(deadline);
          process.stdout.write('electron smoke: trusted game IPC, run archive, settings bootstrap and vault passed\n');
          app.quit();
        } catch(error) { process.stderr.write(`electron smoke: ${error.message}\n`); app.exit(1); }
      });
    } catch(error) { process.stderr.write(`electron smoke: ${error.message}\n`); app.exit(1); }
  });
}
