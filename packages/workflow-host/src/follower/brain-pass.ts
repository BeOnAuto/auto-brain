import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { reactsInBrain } from '../reactions/subscriptions.ts';
import type { BrainRecords } from './brain-records.ts';
import type { Mode } from './delivery-loop.ts';
import type { FollowedBrains, Progress } from './followed-brains.ts';
import { brainOfKey, stepOf, type PassEnd, type StepParts, type Stepping } from './record-steps.ts';
import { runGateOf } from './run-gate.ts';

export interface PassParts extends StepParts {
  readonly database: HostDatabase;
  readonly records: Pick<BrainRecords, 'after'>;
  readonly brains: FollowedBrains;
}

const pagesInAPass = 10;

function pagesPassed(parts: PassParts, stepping: Stepping, start: Progress): Effect.Effect<PassEnd> {
  const { brainKey } = stepping;
  return Effect.gen(function* () {
    let progress = start;
    for (let page = 0; page < pagesInAPass; page += 1) {
      const { records, hasMore } = yield* parts.records.after(brainOfKey(brainKey), progress.cursor, stepping.withData);
      for (const record of records) {
        const step = yield* stepOf(parts, stepping, progress, record);
        progress = step.progress;
        if (step.end !== undefined) {
          yield* parts.brains.save(brainKey, progress);
          return step.end;
        }
      }
      if (!hasMore) {
        yield* parts.brains.save(brainKey, { ...progress, waiting: false });
        return 'caught_up';
      }
    }
    yield* parts.brains.save(brainKey, { ...progress, waiting: true });
    return 'more';
  });
}

export function passOf(parts: PassParts) {
  return (brainKey: string, mode: Mode): Effect.Effect<PassEnd> =>
    Effect.gen(function* () {
      const followed = yield* parts.brains.load(brainKey);
      if (followed === undefined) {
        return 'caught_up';
      }
      if (followed.attempts > 0 && mode === 'signal') {
        return 'waiting';
      }
      const withData = yield* reactsInBrain(parts.database, brainKey);
      return yield* pagesPassed(
        parts,
        { brainKey, gate: runGateOf(parts.database, brainKey), mode, withData },
        followed,
      );
    });
}
