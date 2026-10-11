import { Effect, Function } from 'effect';

import { openHostDatabase, type DatabaseSettings } from '../src/database/host-databases.ts';
import { passOf } from '../src/follower/brain-pass.ts';
import { brainRecordsOf } from '../src/follower/brain-records.ts';
import { followedBrainsOn } from '../src/follower/followed-brains.ts';
import { byAdmin, definitionRecorded, eventTrigger, published } from '../src/reaction-testing/brain-writes.ts';
import { definitionRecordsKeepingTheirOwnStops } from '../src/reaction-testing/own-stops.ts';
import { brainSweepsOn, type BrainSweeps } from '../src/sweeps/brain-sweeps.ts';
import { resultOfEnding } from '../src/waiting-testing/recorded-waiting.ts';
import { servedWaitingOf } from '../src/waiting/waiting-parts.ts';

export interface SweepCost {
  readonly brains: number;
  readonly reacting: number;
  readonly roundMs: number;
  readonly idleMs: number;
  readonly changedMs: number;
}

type Pass = ReturnType<typeof passOf>;

const idleSweeps = 20;

function brainKeyOf(index: number): string {
  return `brain/acme/b${index}/`;
}

function inTurn(count: number, step: (index: number) => Promise<unknown>): Promise<void> {
  return Array.from({ length: count }, (_, index) => index).reduce<Promise<void>>(
    (before, index) => before.then(() => step(index)).then(Function.constVoid),
    Promise.resolve(),
  );
}

function sweptUntilEmpty(sweeps: BrainSweeps, pass: Pass): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (;;) {
      const sweep = yield* sweeps.next();
      if (sweep.brains.length === 0) {
        return;
      }
      yield* Effect.forEach(sweep.brains, ({ brainKey, known }) => pass(brainKey, 'sweep', known), { discard: true });
    }
  });
}

async function timed(work: Effect.Effect<void>): Promise<number> {
  const began = performance.now();
  await Effect.runPromise(work);
  return performance.now() - began;
}

function medianOf(times: readonly number[]): number {
  return times.toSorted((left, right) => left - right)[Math.floor(times.length / 2)] ?? 0;
}

export async function sweepCostOn(database: DatabaseSettings, brains: number, reacting: number): Promise<SweepCost> {
  const opened = await openHostDatabase(database, Function.constVoid);
  const followed = followedBrainsOn(opened);
  await inTurn(brains, async (index) => {
    await published(opened.store, { id: `e${index}`, type: 'com.measure.other' }, byAdmin, brainKeyOf(index));
    await Effect.runPromise(followed.follow(brainKeyOf(index), null));
  });
  await inTurn(reacting, (index) =>
    definitionRecorded(
      opened.store,
      { name: 'react', version: 1, triggers: [eventTrigger({ type: 'com.measure.wanted' })] },
      brainKeyOf(index),
    ),
  );
  const pass = passOf({
    database: opened,
    records: brainRecordsOf(opened.store),
    brains: followed,
    consumers: [],
    calls: servedWaitingOf({
      database: opened,
      submitted: Effect.die,
      resultOf: resultOfEnding,
      cancelDeferred: () => Effect.void,
      workflows: 'workflow',
      now: Date.now,
      trouble: () => Effect.void,
    }).calls,
    definitionType: 'workflow',
    applyDefinitionRecord: definitionRecordsKeepingTheirOwnStops(opened),
    unreadable: () => Effect.void,
    passedEarly: () => Effect.void,
    registered: [],
  });
  const sweeps = brainSweepsOn(opened.store, followed);
  await Effect.runPromise(sweeps.started());
  const roundMs = await timed(sweptUntilEmpty(sweeps, pass));
  const idle: number[] = [];
  await inTurn(idleSweeps, async () => {
    idle.push(await timed(sweptUntilEmpty(sweeps, pass)));
  });
  await inTurn(brains, (index) =>
    published(opened.store, { id: `n${index}`, type: 'com.measure.other' }, byAdmin, brainKeyOf(index)),
  );
  const changedMs = await timed(sweptUntilEmpty(sweeps, pass));
  await opened.close();
  return { brains, reacting, roundMs, idleMs: medianOf(idle), changedMs };
}
