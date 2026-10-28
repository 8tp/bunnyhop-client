const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bunnyhopSettings', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('settings:bootstrap'),
  save: (settings) => ipcRenderer.invoke('settings:save', settings),
  applyPreset: (profile) => ipcRenderer.invoke('settings:apply-preset', profile),
  diagnostics: () => ipcRenderer.invoke('settings:diagnostics'),
  exportReport: () => ipcRenderer.invoke('settings:export-report'),
  capture: () => ipcRenderer.invoke('settings:capture'),
  listVault: () => ipcRenderer.invoke('settings:list-vault'),
  vaultScreenshot: (id) => ipcRenderer.invoke('settings:vault-screenshot', String(id ?? '').slice(0, 64)),
  openVault: () => ipcRenderer.invoke('settings:open-vault'),
  onVaultChanged: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = () => listener();
    ipcRenderer.on('vault:changed', wrapped);
    return () => ipcRenderer.removeListener('vault:changed', wrapped);
  },
  onDiscordStatus: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, value) => listener(value);
    ipcRenderer.on('discord:status', wrapped);
    return () => ipcRenderer.removeListener('discord:status', wrapped);
  },
  onUpdateStatus: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, value) => listener(value);
    ipcRenderer.on('update:status', wrapped);
    return () => ipcRenderer.removeListener('update:status', wrapped);
  },
  openUpdate: () => ipcRenderer.invoke('settings:open-update'),
  startBenchmark: () => ipcRenderer.invoke('settings:benchmark-start'),
  onBenchmarkState: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, value) => listener(value);
    ipcRenderer.on('benchmark:state', wrapped);
    return () => ipcRenderer.removeListener('benchmark:state', wrapped);
  },
  onBenchmarkResults: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, value) => listener(value);
    ipcRenderer.on('benchmark:results', wrapped);
    return () => ipcRenderer.removeListener('benchmark:results', wrapped);
  },
  chooseCustomCss: () => ipcRenderer.invoke('settings:custom-css-choose'),
  newCustomCss: () => ipcRenderer.invoke('settings:custom-css-new'),
  clearCustomCss: () => ipcRenderer.invoke('settings:custom-css-clear'),
  revealCustomCss: () => ipcRenderer.invoke('settings:custom-css-reveal'),
  openSkiesFolder: () => ipcRenderer.invoke('settings:open-skies-folder'),
  onCustomCssStatus: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, value) => listener(value);
    ipcRenderer.on('custom-css:status', wrapped);
    return () => ipcRenderer.removeListener('custom-css:status', wrapped);
  },
  relaunch: () => ipcRenderer.invoke('settings:relaunch'),
}));
