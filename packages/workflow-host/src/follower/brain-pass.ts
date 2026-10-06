import type { RecordedPage } from '@beonauto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { reactsInBrain } from '../reactions/subscriptions.ts';
import type { BrainRecords } from './brain-records.ts';
import type { Mode } from './delivery-loop.ts';
import type { FollowedBrain, FollowedBrains, Progress } from './followed-brains.ts';
import { brainOfKey, stepOf, type PassEnd, type StepParts, type Stepping } from './record-steps.ts';
import { runGateOf } from './run-gate.ts';

export interface PassParts extends StepParts {
  readonly database: HostDatabase;
  readonly records: Pick<BrainRecords, 'after'>;
  readonly brains: FollowedBrains;
}

const pagesInAPass = 10;

function pagesPassed(
  parts: PassParts,
  stepping: Stepping,
  start: Progress,
  glance: RecordedPage | undefined,
): Effect.Effect<PassEnd> {
  const { brainKey } = stepping;
  return Effect.gen(function* () {
    let progress = start;
    let first = glance;
    for (let page = 0; page < pagesInAPass; page += 1) {
      const { records, hasMore } =
        first ?? (yield* parts.records.after(brainOfKey(brainKey), progress.cursor, stepping.withData));
      first = undefined;
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
  return (brainKey: string, mode: Mode, known?: FollowedBrain): Effect.Effect<PassEnd> =>
    Effect.gen(function* () {
      const followed = known ?? (yield* parts.brains.load(brainKey));
      if (followed === undefined) {
        return 'caught_up';
      }
      if (followed.attempts > 0 && mode === 'signal') {
        return 'waiting';
      }
      const glance = yield* parts.records.after(brainOfKey(brainKey), followed.cursor, false);
      if (glance.records.length === 0 && !glance.hasMore) {
        return 'caught_up';
      }
      const withData = yield* reactsInBrain(parts.database, brainKey);
      const stepping = { brainKey, gate: runGateOf(parts.database, brainKey), mode, withData };
      return yield* pagesPassed(parts, stepping, followed, withData ? undefined : glance);
    });
}
