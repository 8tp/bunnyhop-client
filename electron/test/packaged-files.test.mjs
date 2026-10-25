import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..');
const listed = new Set(
  readFileSync(path.join(dir, 'electron-builder.yml'), 'utf8')
    .split('\n')
    .map((l) => /^\s+-\s+(electron\/[\w./*-]+)\s*$/.exec(l)?.[1])
    .filter(Boolean),
);

/* Every local module the main process loads must be in electron-builder's `files`, or the packaged app fails to start
   (0.2.2 almost shipped without electron/custom-css.mjs). */
test('every module main.mjs imports is packaged', () => {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(path.join(dir, path.basename(file)), 'utf8');
    for (const [, spec] of src.matchAll(/from\s+['"]\.\/([\w.-]+\.(?:mjs|cjs))['"]/g)) walk(spec);
  };
  walk('main.mjs');
  for (const file of seen) assert.ok(listed.has(`electron/${file}`), `electron/${file} is imported but not in electron-builder.yml files`);
  for (const preload of ['game-preload.cjs', 'settings-preload.cjs']) assert.ok(listed.has(`electron/${preload}`));
});
