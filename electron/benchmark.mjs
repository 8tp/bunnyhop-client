import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/* Frame-time results from the game's benchmark (apps/web/src/benchmark.ts),
   with what this launch ran with, kept on this computer so profiles can be
   compared with numbers. The game's numbers are only checked and bounded. */

export const BENCHMARK_SECONDS = 30;
const KEEP = 20;

const num = (value, max) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value * 1000) / 1000 : null);
const text = (value, max = 80) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const record = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {});

export function sanitizeBenchmark(raw, launch = {}) {
  raw = record(raw);
  const interval = record(raw.interval);
  const work = record(raw.work);
  const g = record(raw.graphics);
  const frames = num(raw.frames, 1e7);
  if (!frames || num(interval.avg, 1e5) === null) return null;
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    map: text(raw.map, 64),
    seconds: num(raw.seconds, 3600),
    frames: Math.round(frames),
    interval: { avg: num(interval.avg, 1e5), p50: num(interval.p50, 1e5), p99: num(interval.p99, 1e5), max: num(interval.max, 1e5) },
    work: { p50: num(work.p50, 1e5), p99: num(work.p99, 1e5), max: num(work.max, 1e5) },
    hitches: Math.round(num(raw.hitches, 1e7) ?? 0),
    graphics: {
      potato: g.potato === true,
      resolutionScale: num(g.resolutionScale, 8),
      antialias: g.antialias === true,
      uncapped: g.uncapped === true,
      lowLatency: g.lowLatency === true,
      fpsLimit: num(g.fpsLimit, 100000),
      width: num(g.width, 100000),
      height: num(g.height, 100000),
    },
    launch: {
      profile: text(launch.profile, 16),
      uncap: launch.uncap === true,
      gpuBackend: text(launch.gpuBackend, 16),
      processPriority: text(launch.processPriority, 16),
      display: text(launch.display, 64),
      refreshHz: num(launch.refreshHz, 1000),
    },
  };
}

export class BenchmarkStore {
  constructor(file) { this.file = file; }

  list() {
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8'));
      return Array.isArray(value) ? value.slice(0, KEEP) : [];
    } catch { return []; }
  }

  add(result) {
    const next = [result, ...this.list()].slice(0, KEEP);
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.file);
    return next;
  }
}
