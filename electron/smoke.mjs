import { existsSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

/* run-smoke.mjs chooses this file before launch; the packaged smoke test has none. */
function smokeCustomCss() {
  const file = path.join(path.dirname(process.env.BUNNYHOP_SETTINGS_FILE || ''), 'smoke.css');
  return process.env.BUNNYHOP_SETTINGS_FILE && existsSync(file) ? file : null;
}

async function waitFor(win, expression, what) {
  for (let i = 0; i < 50; i++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(what);
}

export function runSmoke({ app, win, mode, createSettingsWindow }) {
  const cssFile = smokeCustomCss();
  const deadline = setTimeout(() => { process.stderr.write('electron smoke: timeout\n'); app.exit(1); }, 45000);
  win.webContents.once('dom-ready', async () => {
    try {
      const bridge = await win.webContents.executeJavaScript(`(async()=>{
        if (window.bunnyhopClient?.version !== 1) throw new Error('missing game bridge');
        const settings=await window.bunnyhopClient.getSettings();
        if (settings.discordRichPresence !== true || settings.privacyMode !== false) throw new Error('unexpected public settings');
        const cacheBytes = new Uint8Array([1,2,3]);
        const cacheHash = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
        if (!await window.bunnyhopClient.cacheContent(cacheHash, cacheBytes)) throw new Error('cache write failed');
        const cacheHit = await window.bunnyhopClient.getCachedContent(cacheHash);
        if (cacheHit?.length !== 3 || cacheHit[2] !== 3) throw new Error('cache IPC read failed');
        window.bunnyhopClient.setPresence({kind:'results',mapId:'bhop_smoke',mapName:'Smoke',mode:'solo'});
        const run=await window.bunnyhopClient.saveRunSummary({mapId:'bhop_smoke',mapName:'Smoke',timeMs:1234,ticks:158,tickRate:128,personalBest:true,verified:false,mode:'solo'});
        if (!run.saved || !run.id) throw new Error('vault archive failed');
        window.bunnyhopClient.resultSettled(run.id);
        if (${Boolean(cssFile)}) {
          window.__smokeCss = [];
          window.bunnyhopClient.onCustomCss(v => window.__smokeCss.push(v));
        }
        return true;
      })()`);
      if (!bridge) throw new Error('game bridge failed');
      if (cssFile) {
        await waitFor(win, `window.__smokeCss.length > 0`, 'custom CSS not sent on registration');
        const first = await win.webContents.executeJavaScript(`window.__smokeCss[0]`);
        if (first?.name !== 'smoke.css' || first?.css !== '.smoke{}' || Object.keys(first).length !== 2) throw new Error('custom CSS first value wrong');
        // An editor-style save: a temporary file renamed over the chosen one.
        writeFileSync(`${cssFile}.tmp`, '.smoke{color:red}');
        renameSync(`${cssFile}.tmp`, cssFile);
        await waitFor(win, `window.__smokeCss.at(-1)?.css === '.smoke{color:red}'`, 'custom CSS save not followed');
      }
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
        if (cssFile) {
          await win.webContents.executeJavaScript(`window.__smokeCss=[]; window.bunnyhopClient.onCustomCss(v => window.__smokeCss.push(v)); true`);
          await new Promise(resolve => setTimeout(resolve, 500));
          if (await win.webContents.executeJavaScript(`window.__smokeCss.length`)) throw new Error('untrusted origin got custom CSS');
        }
        // Back on the game, which registers a benchmark that answers at once (the real one measures 30 s of play).
        await win.loadURL('https://bunnyhop.lol/');
        await win.webContents.executeJavaScript(`window.bunnyhopClient.onBenchmark(r => window.bunnyhopClient.benchmarkResult({map:'bhop_smoke',seconds:r.seconds,frames:900,interval:{avg:3.3,p50:3.2,p99:6.1,max:20},work:{p50:1,p99:2,max:3},hitches:2,graphics:{width:1280,height:720}})); true`);
      }
      const settings = createSettingsWindow();
      settings.webContents.once('dom-ready', async () => {
        try {
          await settings.webContents.executeJavaScript(`(async()=>{
            if (!Object.isFrozen(window.bunnyhopSettings)) throw new Error('missing settings bridge');
            const b=await window.bunnyhopSettings.bootstrap();
            if(b.settings.profile!=='balanced') throw new Error('bad default profile');
            if(${Boolean(cssFile)} && (b.customCss?.name!=='smoke.css' || b.customCss?.error!==null || document.querySelector('#css-file')===null)) throw new Error('custom CSS status missing');
            const runs=await window.bunnyhopSettings.listVault();
            if(!runs.some(r=>r.mapId==='bhop_smoke' && r.timeMs===1234 && r.verified===false)) throw new Error('archive not visible');
            if(!document.querySelector('#settings-form')) throw new Error('settings form absent');
            if(${mode !== 'live'}) {
              if(!b.benchmark?.ready) throw new Error('benchmark not offered');
              const results=new Promise((resolve,reject)=>{window.bunnyhopSettings.onBenchmarkResults(resolve);setTimeout(()=>reject(new Error('benchmark result missing')),5000);});
              await window.bunnyhopSettings.startBenchmark();
              const list=await results;
              if(list[0]?.frames!==900 || list[0]?.map!=='bhop_smoke' || list[0]?.launch?.profile!=='balanced') throw new Error('benchmark result not saved');
            }
          })()`);
          if (process.env.BUNNYHOP_SMOKE_SCREENSHOT) {
            await new Promise(resolve => setTimeout(resolve,500));
            writeFileSync(process.env.BUNNYHOP_SMOKE_SCREENSHOT,(await settings.capturePage()).toPNG());
          }
          clearTimeout(deadline);
          process.stdout.write(`electron smoke: trusted game IPC, run archive, settings bootstrap, vault${cssFile ? ', custom CSS' : ''} and benchmark passed\n`);
          app.quit();
        } catch(error) { process.stderr.write(`electron smoke: ${error.message}\n`); app.exit(1); }
      });
    } catch(error) { process.stderr.write(`electron smoke: ${error.message}\n`); app.exit(1); }
  });
}
