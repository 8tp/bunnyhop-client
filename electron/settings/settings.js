const api = window.bunnyhopSettings;
const form = document.querySelector('#settings-form');
const status = document.querySelector('#status');
let settings;
const show = value => {status.textContent=value;};
function fill(value,restart=false) {
 settings=value;
 for(const el of form.elements) if(el.name && Object.hasOwn(value,el.name)) {if(el.type==='checkbox') el.checked=value[el.name]; else el.value=value[el.name];}
 document.querySelector('#relaunch').hidden=!restart;
}
function update(v) {
 const text={available:`Bunnyhop ${v.version} is available${v.notes?' · '+v.notes:''}`,current:'This is the latest client.',error:`Update check failed · ${v.message}`}[v.state];
 document.querySelector('#update-status').textContent=text || '';
 document.querySelector('#open-update').hidden=v.state!=='available';
}
function discord(v) {document.querySelector('#discord-status').textContent=`Discord: ${v.state}${v.message ? ' · '+v.message : ''}`;}
async function refreshRuns() {
 const root=document.querySelector('#runs'); root.replaceChildren();
 const runs=await api.listVault();
 if(!runs.length) {root.textContent='Completed runs will appear here.';return;}
 for(const r of runs) {
  const row=document.createElement('div');row.className='run';
  const caption=document.createElement('span');caption.textContent=`${r.mapName || r.mapId} · ${r.style || 'default'} · ${(r.timeMs/1000).toFixed(3)}s${r.personalBest?' · PB':''}${r.verified?' · server verified':' · local'} · ${new Date(r.savedAt).toLocaleString()}`;
  row.append(caption);
  if(r.hasScreenshot) {const button=document.createElement('button');button.type='button';button.textContent='View';button.onclick=async()=>{const v=await api.vaultScreenshot(r.id);if(v.found){const img=document.querySelector('#run-image');img.src=`data:${v.mime};base64,${v.data}`;img.hidden=false;}};row.append(button);}
  root.append(row);
 }
}
form.addEventListener('change',e=>{if(['windowMode','preferredDisplay','preferHighestRefresh','uncap','preferDiscreteGpu','gpuBackend','pinDeviceScale','processPriority'].includes(e.target.name))form.elements.profile.value='custom';});
form.addEventListener('submit',async e=>{e.preventDefault();try{const value={...settings};for(const el of form.elements) if(el.name) value[el.name]=el.type==='checkbox'?el.checked:el.value;const r=await api.save(value);fill(r.settings,r.requiresRestart);show(r.requiresRestart?'Saved. Restart when ready to apply display and rendering changes.':'Saved.');}catch(e){show(e.message);}});
form.elements.profile.addEventListener('change',async()=>{if(form.elements.profile.value==='custom')return;try{const r=await api.applyPreset(form.elements.profile.value);fill(r.settings,r.requiresRestart);show('Profile saved.');}catch(e){show(e.message);}});
for(const [id,action] of Object.entries({'open-vault':()=>api.openVault(),capture:()=>api.capture(),'export-report':()=>api.exportReport(),'open-update':()=>api.openUpdate(),relaunch:()=>api.relaunch()})) document.getElementById(id).onclick=async()=>{try{const v=await action();show(v?.saved===false?'Canceled.':v?.error || 'Done.');}catch(e){show(e.message);}};
document.querySelector('#diagnostics').onclick=async()=>{try{const report=document.querySelector('#report');report.textContent=JSON.stringify(await api.diagnostics(),null,2);report.hidden=false;}catch(e){show(e.message);}};
api.onVaultChanged(()=>refreshRuns().catch(e=>show(e.message)));api.onDiscordStatus(discord);api.onUpdateStatus(update);
(async()=>{try{const b=await api.bootstrap();for(const d of b.displays){const o=document.createElement('option');o.value=`display:${d.id}`;o.textContent=`${d.label} · ${d.frequency || '?'} Hz`;document.querySelector('#displays').append(o);}fill(b.settings,b.requiresRestart);discord(b.discord);update(b.update);await refreshRuns();}catch(e){show(`Settings unavailable: ${e.message}`);}})();
