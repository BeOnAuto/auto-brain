import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { wallClock } from './scheduler.ts';
import { freshFile, seedTimers, summarize } from './timer-plan.ts';

const here = import.meta.dirname;

interface Variant {
  readonly name: string;
  readonly mode: 'naive' | 'claim-then-fire';
  readonly busyTimeoutMs: number;
  readonly locking: 'NORMAL' | 'EXCLUSIVE';
}

function run(fileName: string, by: string, variant: Variant): Promise<readonly string[]> {
  const child = spawn(
    process.execPath,
    ['scheduler-process.ts', fileName, by, variant.mode, '26000', String(variant.busyTimeoutMs), variant.locking],
    { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const lines: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => {
    lines.push(...chunk.toString().trim().split('\n'));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    lines.push(`stderr: ${chunk.toString().trim().split('\n')[0] ?? ''}`);
  });
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      resolve([...lines, `exit code ${String(code)}, signal ${String(signal)}`]);
    });
  });
}

async function trial(variant: Variant): Promise<object> {
  const fileName = freshFile(`two-schedulers-${variant.name}`);
  const plan = seedTimers(fileName, 300, wallClock() + 2_000, 20_000);
  const first = run(fileName, 'process-a', variant);
  await sleep(variant.locking === 'EXCLUSIVE' ? 1_000 : 0);
  const second = run(fileName, 'process-b', variant);
  const outputs = { a: await first, b: await second };
  return { variant, ...summarize(fileName, plan), outputs };
}

const variants: readonly Variant[] = [
  { name: 'naive', mode: 'naive', busyTimeoutMs: 5_000, locking: 'NORMAL' },
  { name: 'conditional-claim', mode: 'claim-then-fire', busyTimeoutMs: 5_000, locking: 'NORMAL' },
  { name: 'conditional-claim-no-busy-timeout', mode: 'claim-then-fire', busyTimeoutMs: 0, locking: 'NORMAL' },
  { name: 'exclusive-locking', mode: 'claim-then-fire', busyTimeoutMs: 5_000, locking: 'EXCLUSIVE' },
];
const report: object[] = [];
for (const variant of variants) {
  const result = await trial(variant);
  console.log(JSON.stringify(result));
  report.push(result);
}
writeFileSync(join(here, '..', 'results', 'timers-two-processes.json'), `${JSON.stringify(report, null, 2)}\n`);
