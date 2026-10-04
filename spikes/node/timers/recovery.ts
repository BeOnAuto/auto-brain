import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';

import { wallClock } from './scheduler.ts';
import { freshFile, seedTimers, summarize } from './timer-plan.ts';

const here = import.meta.dirname;

function scheduler(fileName: string, by: string, runForMs: number): { child: ChildProcess; lines: string[] } {
  const child = spawn(process.execPath, ['scheduler-process.ts', fileName, by, 'claim-then-fire', String(runForMs)], {
    cwd: here,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const lines: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => {
    lines.push(...chunk.toString().trim().split('\n'));
  });
  return { child, lines };
}

function exitOf(child: ChildProcess): Promise<string> {
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      resolve(`code ${String(code)}, signal ${String(signal)}`);
    });
  });
}

const fileName = freshFile('recovery');
const from = wallClock() + 2_000;
const plan = seedTimers(fileName, 200, from, 40_000);
const first = scheduler(fileName, 'before-crash', 120_000);
const firstExit = exitOf(first.child);
await sleep(15_000);
first.child.kill('SIGKILL');
const killedAt = wallClock();
const killed = await firstExit;
await sleep(15_000);
const restartedAt = wallClock();
const second = scheduler(fileName, 'after-restart', 30_000);
const secondExit = await exitOf(second.child);
const database = new DatabaseSync(fileName);
const fireAt = new Map(
  database
    .prepare('SELECT id, fire_at FROM timers')
    .all()
    .map((row) => [String(row['id']), Number(row['fire_at'])]),
);
database.close();
const pastDue = (id: string): boolean => {
  const at = fireAt.get(id) ?? 0;
  return at > killedAt && at <= restartedAt;
};
const report = {
  timers: plan.ids.length,
  killed: `${killed} at +${Math.round(killedAt - from + 2_000)} ms`,
  downtimeMs: Math.round(restartedAt - killedAt),
  dueWhileDown: plan.ids.filter(pastDue).length,
  all: summarize(fileName, plan),
  dueWhileDownFiredAfterRestart: summarize(fileName, plan, pastDue),
  firedOnScheduleBeforeOrAfter: summarize(fileName, plan, (id) => !pastDue(id)),
  secondExit,
  output: [...first.lines, ...second.lines],
};
console.log(JSON.stringify(report, null, 2));
writeFileSync(join(here, '..', 'results', 'timers-recovery.json'), `${JSON.stringify(report, null, 2)}\n`);
