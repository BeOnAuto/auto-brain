import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { logFileOf } from './record.ts';

const here = import.meta.dirname;
const results = join(here, '..', 'results');
const sizes = [1_000, 10_000, 40_000];
const repetitions = 5;
const heapLimitsMiB = [32, 48, 64, 96, 128];

function node(args: readonly string[]): { readonly ok: boolean; readonly out: string; readonly err: string } {
  const run = spawnSync(process.execPath, args, {
    cwd: here,
    encoding: 'utf8',
    maxBuffer: 64 * 1_048_576,
    timeout: 240_000,
  });
  return { ok: run.status === 0, out: run.stdout.trim(), err: run.stderr.trim().split('\n').slice(-3).join(' | ') };
}

function parsed(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function numbersOf(runs: readonly Record<string, unknown>[], key: string): readonly number[] {
  return runs.map((run) => Number(run[key]));
}

const report: Record<string, unknown>[] = [];
for (const size of sizes) {
  const recording = existsSync(logFileOf(size)) ? undefined : node(['record.ts', String(size)]);
  if (recording !== undefined && !recording.ok) {
    throw new Error(recording.err);
  }
  const runs = Array.from({ length: repetitions }, () =>
    parsed(node(['--expose-gc', 'replay.ts', 'replay', String(size)]).out),
  );
  const baseline = parsed(node(['replay.ts', 'baseline', String(size)]).out);
  const underLimit = (limit: number, reading: string): { readonly ok: boolean; readonly wallMs: unknown } => {
    const run = node([`--max-old-space-size=${limit}`, 'replay.ts', 'replay', String(size), 'lean', reading]);
    return { ok: run.ok, wallMs: run.ok ? parsed(run.out)['wallMs'] : 'out of memory' };
  };
  const fits = heapLimitsMiB.map((limit) => ({
    limit,
    held: underLimit(limit, 'held'),
    streamed: underLimit(limit, 'streamed'),
  }));
  const row = {
    size,
    faithful: runs.every((run) => run['faithful'] === true),
    wallMsMedian: median(numbersOf(runs, 'wallMs')),
    wallMsRange: [Math.min(...numbersOf(runs, 'wallMs')), Math.max(...numbersOf(runs, 'wallMs'))],
    cpuMsMedian: median(numbersOf(runs, 'cpuMs')),
    microsPerInputMedian: median(numbersOf(runs, 'microsPerInput')),
    setImmediateMicrosPerInput: baseline['microsPerInput'],
    parseMsMedian: median(numbersOf(runs, 'parseMs')),
    logMiB: runs[0]?.['logMiB'],
    peakHeapAboveStartMiBMedian: median(numbersOf(runs, 'peakHeapAboveStartMiB')),
    retainedRunMiBMedian: median(numbersOf(runs, 'retainedAfterCachesShrinkMiB')),
    retainedRunMiBRange: [
      Math.min(...numbersOf(runs, 'retainedAfterCachesShrinkMiB')),
      Math.max(...numbersOf(runs, 'retainedAfterCachesShrinkMiB')),
    ],
    maxRssMiBMedian: median(numbersOf(runs, 'maxRssMiB')),
    smallestHeapLimitHeldLogMiB: fits.find(({ held }) => held.ok)?.limit ?? 'none tried',
    smallestHeapLimitStreamedLogMiB: fits.find(({ streamed }) => streamed.ok)?.limit ?? 'none tried',
    heapLimits: fits,
  };
  report.push(row);
  console.log(JSON.stringify(row));
}
mkdirSync(results, { recursive: true });
writeFileSync(join(results, 'replay.json'), `${JSON.stringify({ node: process.version, report }, null, 2)}\n`);
