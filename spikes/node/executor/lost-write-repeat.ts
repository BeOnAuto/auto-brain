import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const results = join(here, '..', 'results');
const outcome: Record<string, string[]> = { same: [], separate: [] };
for (const layout of ['same', 'separate']) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    spawnSync(process.execPath, ['real-run.ts'], {
      cwd: here,
      env: { ...process.env, SPIKE_STEP_MS: '3000', SPIKE_TIMERS_FILE: layout },
      encoding: 'utf8',
    });
    const report: unknown = JSON.parse(readFileSync(join(results, 'executor-real.json'), 'utf8'));
    const text = JSON.stringify(report);
    const lost = text.includes('"in:timer_fired(ignored)"');
    outcome[layout]?.push(lost ? 'cancelled timer fired anyway (committed cancel lost)' : 'cancel held');
  }
}
console.log(JSON.stringify(outcome, null, 2));
writeFileSync(join(results, 'lost-write-repeat.json'), `${JSON.stringify(outcome, null, 2)}\n`);
