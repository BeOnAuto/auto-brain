import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { minute, virtualClock, type VirtualClock } from './clocks.ts';
import { Crash, openEngine, type Engine, type Evidence } from './engine.ts';
import { callKeyOf, decisions, timeoutTimerOf, type RunInput } from './run-stream.ts';

const startedAt = Date.parse('2026-10-04T09:00:00.000Z');
const here = import.meta.dirname;
const scratch = join(here, '..', '.data', 'executor-virtual');

async function advance(clock: VirtualClock, engine: Engine, until: number): Promise<void> {
  for (;;) {
    const callback = clock.next();
    const timer = engine.nextTimerAt();
    const next = Math.min(callback ?? Number.POSITIVE_INFINITY, timer ?? Number.POSITIVE_INFINITY);
    if (next > until) {
      clock.setNow(until);
      return;
    }
    clock.setNow(next);
    if (timer !== undefined && timer <= (callback ?? Number.POSITIVE_INFINITY)) {
      await engine.fireDueTimers();
    } else {
      await clock.runNext();
    }
  }
}

async function crashing(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return 'no crash';
  } catch (error) {
    if (error instanceof Crash) {
      return error.message;
    }
    throw error;
  }
}

interface Case {
  readonly name: string;
  readonly evidence: Evidence;
  readonly before?: Evidence;
  readonly effects: readonly string[];
  readonly decisions: number;
  readonly crash?: string;
}

function databaseFor(name: string): string {
  const directory = join(scratch, name);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  return join(directory, 'ledger.db');
}

async function duplicateResult(): Promise<Case> {
  const id = 'run-duplicate-result';
  const fileName = databaseFor(id);
  const clock = virtualClock(startedAt);
  const engine = await openEngine({ name: 'p1', fileName, clock: clock.groupClock('p1'), resultDeliveries: 2 });
  const counted = decisions.made;
  await engine.submit(id, `start:${id}`, { kind: 'start', stepMs: 20 * minute, timeoutMs: 30 * minute });
  await advance(clock, engine, startedAt + 25 * minute);
  const key = callKeyOf(id);
  const again: RunInput = {
    kind: 'call_answered',
    key,
    output: { score: 0.42, answeredBy: 'a retry of the executor' },
  };
  await Promise.all([engine.submit(id, `result:${key}`, again), engine.submit(id, `result:${key}`, again)]);
  await advance(clock, engine, startedAt + 45 * minute);
  const evidence = await engine.inspect(id);
  await engine.close();
  return {
    name: 'result delivered four times (twice in a row, then twice at once)',
    evidence,
    effects: engine.effects(),
    decisions: decisions.made - counted,
  };
}

async function racingFirstDeliveries(): Promise<Case> {
  const id = 'run-racing-deliveries';
  const fileName = databaseFor(id);
  const clock = virtualClock(startedAt);
  const engine = await openEngine({ name: 'p1', fileName, clock: clock.groupClock('p1'), resultDeliveries: 0 });
  const counted = decisions.made;
  await engine.submit(id, `start:${id}`, { kind: 'start', stepMs: 20 * minute, timeoutMs: 30 * minute });
  await advance(clock, engine, startedAt + 20 * minute);
  const key = callKeyOf(id);
  const result: RunInput = { kind: 'call_answered', key, output: { score: 0.42 } };
  const versions = await Promise.all(
    Array.from({ length: 4 }, () => engine.submit(id, `result:${key}`, result).then((state) => state.events)),
  );
  await advance(clock, engine, startedAt + 45 * minute);
  const evidence = await engine.inspect(id);
  await engine.close();
  return {
    name: `four first deliveries at once, at the same expected version (each saw version ${JSON.stringify(versions)} after)`,
    evidence,
    effects: engine.effects(),
    decisions: decisions.made - counted,
  };
}

async function lateResult(): Promise<Case> {
  const id = 'run-late-result';
  const fileName = databaseFor(id);
  const clock = virtualClock(startedAt);
  const engine = await openEngine({ name: 'p1', fileName, clock: clock.groupClock('p1'), resultDeliveries: 2 });
  const counted = decisions.made;
  await engine.submit(id, `start:${id}`, { kind: 'start', stepMs: 20 * minute, timeoutMs: 15 * minute });
  await advance(clock, engine, startedAt + 45 * minute);
  const evidence = await engine.inspect(id);
  await engine.close();
  return {
    name: 'result arrives at 20 min, after the 15 min timeout fired (delivered twice)',
    evidence,
    effects: engine.effects(),
    decisions: decisions.made - counted,
  };
}

async function crashAfterAppend(): Promise<Case> {
  const id = 'run-crash-after-append';
  const fileName = databaseFor(id);
  const clock = virtualClock(startedAt);
  const first = await openEngine({ name: 'p1', fileName, clock: clock.groupClock('p1') });
  const counted = decisions.made;
  const crash = await crashing(
    first.submit(id, `start:${id}`, { kind: 'start', stepMs: 20 * minute, timeoutMs: 30 * minute }, 'after-append'),
  );
  const before = await first.inspect(id);
  clock.drop('p1');
  await first.close();
  clock.setNow(startedAt + minute);
  const second = await openEngine({ name: 'p2', fileName, clock: clock.groupClock('p2') });
  await second.wake([id]);
  await advance(clock, second, startedAt + 45 * minute);
  const evidence = await second.inspect(id);
  await second.close();
  return {
    name: 'crash after the append, before dispatch; recovered by the watermark on wake',
    before,
    evidence,
    crash,
    effects: [...first.effects(), ...second.effects()],
    decisions: decisions.made - counted,
  };
}

async function crashAfterDispatch(): Promise<Case> {
  const id = 'run-crash-after-dispatch';
  const fileName = databaseFor(id);
  const clock = virtualClock(startedAt);
  const first = await openEngine({ name: 'p1', fileName, clock: clock.groupClock('p1') });
  const counted = decisions.made;
  const crash = await crashing(
    first.submit(id, `start:${id}`, { kind: 'start', stepMs: 20 * minute, timeoutMs: 30 * minute }, 'after-dispatch'),
  );
  const before = await first.inspect(id);
  clock.drop('p1');
  await first.close();
  clock.setNow(startedAt + minute);
  const second = await openEngine({ name: 'p2', fileName, clock: clock.groupClock('p2') });
  await second.wake([id]);
  await advance(clock, second, startedAt + 45 * minute);
  const evidence = await second.inspect(id);
  await second.close();
  return {
    name: 'crash after dispatch, before the watermark advanced; outputs redone on wake',
    before,
    evidence,
    crash,
    effects: [...first.effects(), ...second.effects()],
    decisions: decisions.made - counted,
  };
}

async function timerFiredTwice(): Promise<Case> {
  const id = 'run-timer-fired-twice';
  const fileName = databaseFor(id);
  const clock = virtualClock(startedAt);
  const first = await openEngine({ name: 'p1', fileName, clock: clock.groupClock('p1') });
  const counted = decisions.made;
  await first.submit(id, `start:${id}`, { kind: 'start', stepMs: 40 * minute, timeoutMs: 15 * minute });
  clock.setNow(startedAt + 15 * minute);
  const timer = timeoutTimerOf(callKeyOf(id));
  await first.submit(id, `fired:${timer}`, { kind: 'timer_fired', timer });
  const before = await first.inspect(id);
  clock.drop('p1');
  await first.close();
  clock.setNow(startedAt + 16 * minute);
  const second = await openEngine({ name: 'p2', fileName, clock: clock.groupClock('p2') });
  await second.wake([id]);
  await advance(clock, second, startedAt + 60 * minute);
  const evidence = await second.inspect(id);
  await second.close();
  return {
    name: 'crash after the timer input was appended, before the timer row was marked fired: it fires again on wake',
    before,
    evidence,
    crash: 'simulated between append and markFired',
    effects: [...first.effects(), ...second.effects()],
    decisions: decisions.made - counted,
  };
}

const cases = [
  await duplicateResult(),
  await racingFirstDeliveries(),
  await lateResult(),
  await crashAfterAppend(),
  await crashAfterDispatch(),
  await timerFiredTwice(),
];
for (const each of cases) {
  console.log(`\n## ${each.name}`);
  if (each.crash !== undefined) {
    console.log(`crash: ${each.crash}`);
  }
  if (each.before !== undefined) {
    console.log(
      `before wake: run v${each.before.runVersion} ${JSON.stringify(each.before.run)} watermark=${each.before.watermark} job=${JSON.stringify(each.before.job)} timers=${JSON.stringify(each.before.timers)}`,
    );
  }
  const { evidence } = each;
  console.log(
    `run v${evidence.runVersion} phase=${evidence.phase} outcomes=${evidence.outcomes} watermark=${evidence.watermark}`,
  );
  console.log(`run events: ${JSON.stringify(evidence.run)}`);
  console.log(`consumed message ids: ${JSON.stringify(evidence.consumedIds)}`);
  console.log(`job events: ${JSON.stringify(evidence.job)}`);
  console.log(`timers: ${JSON.stringify(evidence.timers)}`);
  console.log(`decisions taken by the run decider: ${each.decisions}`);
  console.log(`effects: ${JSON.stringify(each.effects)}`);
}
mkdirSync(join(here, '..', 'results'), { recursive: true });
writeFileSync(join(here, '..', 'results', 'executor-virtual.json'), `${JSON.stringify(cases, null, 2)}\n`);
