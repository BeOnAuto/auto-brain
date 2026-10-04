import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { startScheduler } from '../timers/scheduler.ts';
import { realClock } from './clocks.ts';
import { openEngine } from './engine.ts';

const stepMs = Number(process.env['SPIKE_STEP_MS'] ?? '150000');
const here = import.meta.dirname;
const directory = join(here, '..', '.data', 'executor-real');
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const fileName = join(directory, 'ledger.db');
const began = Date.now();
const log: string[] = [];
const note = (text: string): void => {
  const line = `+${((Date.now() - began) / 1000).toFixed(1)}s ${text}`;
  log.push(line);
  console.log(line);
};

const timersFileName = process.env['SPIKE_TIMERS_FILE'] === 'same' ? fileName : join(directory, 'timers.db');
const engine = await openEngine({ name: 'p-main', fileName, timersFileName, clock: realClock(), resultDeliveries: 2 });
const lateness: number[] = [];
engine.attachScheduler(
  startScheduler({
    store: engine.timers,
    by: 'p-main',
    mode: 'fire-then-mark',
    fire: async (timer, lateMs) => {
      lateness.push(lateMs);
      note(`timer ${timer.id} fires ${lateMs.toFixed(1)} ms late`);
      await engine.submit(timer.runId, `fired:${timer.id}`, { kind: 'timer_fired', timer: timer.id });
    },
    onError: (error) => {
      note(`scheduler error ${String(error)}`);
    },
  }),
);

const duplicate = 'real-duplicate-result';
const late = 'real-late-result';
const crashed = 'real-crash-after-append';
await engine.submit(duplicate, `start:${duplicate}`, { kind: 'start', stepMs, timeoutMs: Math.round(stepMs * 1.6) });
note(`${duplicate} started: step ${stepMs} ms, timeout ${Math.round(stepMs * 1.6)} ms`);
await engine.submit(late, `start:${late}`, { kind: 'start', stepMs, timeoutMs: Math.round(stepMs * 0.6) });
note(`${late} started: step ${stepMs} ms, timeout ${Math.round(stepMs * 0.6)} ms`);

const child = spawn(
  process.execPath,
  ['real-crasher.ts', fileName, crashed, String(stepMs), String(Math.round(stepMs * 1.6))],
  {
    cwd: here,
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
const appended = await new Promise<string>((resolve) => {
  child.stdout.on('data', (chunk: Buffer) => {
    resolve(chunk.toString().trim());
  });
});
note(`child ${crashed}: ${appended}; killing it with SIGKILL before it dispatches`);
const exited = new Promise<string>((resolve) => {
  child.on('exit', (code, signal) => {
    resolve(`code ${String(code)}, signal ${String(signal)}`);
  });
});
child.kill('SIGKILL');
note(`child exited: ${await exited}`);
const beforeWake = await engine.inspect(crashed);
note(`before wake: ${JSON.stringify(beforeWake)}`);
await engine.wake([crashed]);
note(`${crashed} woken by p-main`);

await sleep(Math.round(stepMs * 1.7));
const cases = {
  [duplicate]: await engine.inspect(duplicate),
  [late]: await engine.inspect(late),
  [crashed]: { beforeWake, after: await engine.inspect(crashed) },
};
for (const [name, evidence] of Object.entries(cases)) {
  note(`${name}: ${JSON.stringify(evidence)}`);
}
await engine.close();
const report = { stepMs, timerLatenessMs: lateness, cases, effects: engine.effects(), log };
writeFileSync(join(here, '..', 'results', 'executor-real.json'), `${JSON.stringify(report, null, 2)}\n`);
note('done');
