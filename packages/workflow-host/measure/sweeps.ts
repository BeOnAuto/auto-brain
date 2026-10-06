import { Effect, Function } from 'effect';

import type { DatabaseSettings } from '../src/database/host-databases.ts';
import { openHostDatabase } from '../src/database/host-databases.ts';
import { passOf } from '../src/follower/brain-pass.ts';
import { brainRecordsOf } from '../src/follower/brain-records.ts';
import { followedBrainsOn } from '../src/follower/followed-brains.ts';
import { eventTrigger, published, specRecorded, triggerOfSource } from '../src/reaction-testing/brain-writes.ts';
import { specRecordsOn } from '../src/reactions/spec-records.ts';

export interface SweepCost {
  readonly brains: number;
  readonly reacting: number;
  readonly firstMs: number;
  readonly steadyMs: number;
}

function brainKeyOf(index: number): string {
  return `brain/acme/b${index}/`;
}

function inTurn(count: number, step: (index: number) => Promise<unknown>): Promise<void> {
  return Array.from({ length: count }, (_, index) => index).reduce<Promise<void>>(
    (before, index) => before.then(() => step(index)).then(Function.constVoid),
    Promise.resolve(),
  );
}

export async function sweepCostOn(database: DatabaseSettings, brains: number, reacting: number): Promise<SweepCost> {
  const opened = await openHostDatabase(database, Function.constVoid);
  const followed = followedBrainsOn(opened);
  await inTurn(brains, async (index) => {
    await published(opened.store, { id: `e${index}`, type: 'com.measure.other' }, {}, brainKeyOf(index));
    await Effect.runPromise(followed.follow(brainKeyOf(index), null));
  });
  await inTurn(reacting, (index) =>
    specRecorded(
      opened.store,
      { name: 'react', version: 1, trigger: eventTrigger({ type: 'com.measure.wanted' }) },
      brainKeyOf(index),
    ),
  );
  const pass = passOf({
    database: opened,
    records: brainRecordsOf(opened.store),
    brains: followed,
    consumers: [],
    primitive: 'orchestration',
    applySpecRecord: specRecordsOn(opened, triggerOfSource),
    unreadable: () => Effect.void,
  });
  const sweep = async (): Promise<number> => {
    const began = performance.now();
    const due = await Effect.runPromise(followed.dueForASweep(brains));
    await inTurn(due.length, (index) => {
      const brain = due[index];
      return brain === undefined ? Promise.resolve() : Effect.runPromise(pass(brain.brainKey, 'sweep', brain));
    });
    return performance.now() - began;
  };
  const firstMs = await sweep();
  const steadyMs = await sweep();
  await opened.close();
  return { brains, reacting, firstMs, steadyMs };
}
