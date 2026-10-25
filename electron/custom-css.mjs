import * as nodeFs from 'node:fs';
import path from 'node:path';

/* Custom CSS: one local .css file the player picks in F10. The client reads
   its text and hands it to the game, which runs it through its own
   sanitizer (it rewrites every url() itself). Only the text and the file's
   base name ever reach the page; the path, the folder and fs stay here. */

export const CUSTOM_CSS_MAX_CHARS = 262_144;
export const CUSTOM_CSS_MAX_BYTES = 262_144;
export const CUSTOM_CSS_MAX_PATH = 4096;
export const CUSTOM_CSS_DEBOUNCE_MS = 100;
/* How often to look for the folder again when it is missing. */
export const CUSTOM_CSS_RETRY_MS = 2_000;

export const CUSTOM_CSS_STARTER = `/* bunnyhop.lol custom CSS. Saved changes show up in the game right away. */
:root {
  /* --hud-font: "Comic Sans MS"; */
  /* --accent: #7fd1ff; */
}
`;

export const CUSTOM_CSS_ERRORS = Object.freeze({
  tooBig: 'File is over 256 KB',
  missing: 'File not found',
  notFile: 'Not a file',
  unreadable: 'Can’t read the file',
});

/** An absolute path to a .css file, or null. */
export function sanitizeCustomCssPath(value, pathImpl = path) {
  if (typeof value !== 'string' || !value || value.length > CUSTOM_CSS_MAX_PATH) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (!pathImpl.isAbsolute(value) || !/\.css$/i.test(value)) return null;
  return value;
}

/** The base name the game is told: control characters stripped, at most 80 characters. */
export function customCssName(file, pathImpl = path) {
  if (typeof file !== 'string' || !file) return '';
  return pathImpl.basename(file).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
}

/**
 * Read the file once. Returns { value, error }: value is { name, css } or
 * null, error a short sentence for the settings window or null.
 */
export function readCustomCss(file, { fs = nodeFs } = {}) {
  if (!file) return { value: null, error: null };
  let bytes;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { value: null, error: CUSTOM_CSS_ERRORS.notFile };
    if (stat.size > CUSTOM_CSS_MAX_BYTES) return { value: null, error: CUSTOM_CSS_ERRORS.tooBig };
    bytes = fs.readFileSync(file);
  } catch (error) {
    const missing = error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
    return { value: null, error: missing ? CUSTOM_CSS_ERRORS.missing : CUSTOM_CSS_ERRORS.unreadable };
  }
  /* The file can grow between stat and read. */
  if (bytes.length > CUSTOM_CSS_MAX_BYTES) return { value: null, error: CUSTOM_CSS_ERRORS.tooBig };
  const css = bytes.toString('utf8').replace(/^﻿/, '');
  if (css.length > CUSTOM_CSS_MAX_CHARS) return { value: null, error: CUSTOM_CSS_ERRORS.tooBig };
  return { value: { name: customCssName(file), css }, error: null };
}

/**
 * Watches the chosen file and calls onChange({ value, error }) when what
 * the game should see changes. Editors save by writing a temporary file
 * and renaming it over the old one (VS Code, vim), which leaves a watch on
 * the file itself pointing at nothing, so this watches the folder and
 * filters by name. Bursts of events are debounced into one read.
 */
export class CustomCssWatcher {
  constructor({
    onChange = () => {},
    fs = nodeFs,
    setTimeout: setTimer = globalThis.setTimeout,
    clearTimeout: clearTimer = globalThis.clearTimeout,
    debounceMs = CUSTOM_CSS_DEBOUNCE_MS,
    retryMs = CUSTOM_CSS_RETRY_MS,
  } = {}) {
    this.onChange = onChange;
    this.fs = fs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.debounceMs = debounceMs;
    this.retryMs = retryMs;
    this.file = null;
    this.value = null;
    this.error = null;
    this.watcher = null;
    this.readTimer = null;
    this.retryTimer = null;
  }

  /** Start on a new file (or null to stop). Reads at once and reports. */
  watch(file) {
    this.stop();
    this.file = file || null;
    if (!this.file) {
      this.update({ value: null, error: null }, true);
      return;
    }
    this.update(readCustomCss(this.file, { fs: this.fs }), true);
    this.attach();
  }

  /** Read again now. True when that changed what the game should see and onChange ran. */
  refresh() {
    return this.file ? this.update(readCustomCss(this.file, { fs: this.fs })) : false;
  }

  close() {
    this.stop();
    this.file = null;
  }

  stop() {
    this.clearTimer(this.readTimer);
    this.clearTimer(this.retryTimer);
    this.readTimer = null;
    this.retryTimer = null;
    if (this.watcher) {
      const watcher = this.watcher;
      this.watcher = null;
      try { watcher.close(); } catch {}
    }
  }

  attach() {
    const file = this.file;
    const directory = path.dirname(file);
    const name = path.basename(file);
    try {
      const watcher = this.fs.watch(directory, { persistent: false }, (_type, changed) => {
        if (this.watcher !== watcher) return;
        /* Some platforms give no name; then any change in the folder counts. */
        if (changed != null && String(changed) !== name) return;
        this.schedule();
      });
      watcher.on?.('error', () => {
        if (this.watcher !== watcher) return;
        this.detachAndRetry();
      });
      this.watcher = watcher;
    } catch {
      /* The folder is gone (an unplugged drive, a deleted project). */
      this.detachAndRetry();
    }
  }

  detachAndRetry() {
    if (this.watcher) {
      const watcher = this.watcher;
      this.watcher = null;
      try { watcher.close(); } catch {}
    }
    this.update(readCustomCss(this.file, { fs: this.fs }));
    this.clearTimer(this.retryTimer);
    const file = this.file;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      if (this.file !== file || this.watcher) return;
      this.refresh();
      this.attach();
    }, this.retryMs);
  }

  schedule() {
    this.clearTimer(this.readTimer);
    const file = this.file;
    this.readTimer = this.setTimer(() => {
      this.readTimer = null;
      if (this.file === file) this.refresh();
    }, this.debounceMs);
  }

  update(next, force = false) {
    const same = next.error === this.error
      && (next.value === null ? this.value === null : this.value !== null && next.value.name === this.value.name && next.value.css === this.value.css);
    this.value = next.value;
    this.error = next.error;
    if (same && !force) return false;
    try { this.onChange({ value: this.value, error: this.error }); } catch {}
    return true;
  }
}
