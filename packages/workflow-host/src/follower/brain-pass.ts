import type { RecordedPage } from '@beonauto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { wantedTypesIn } from '../triggers/trigger-rows.ts';
import { noRecordTypes, recordTypesOf, type BrainRecords } from './brain-records.ts';
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
        first ?? (yield* parts.records.after(brainOfKey(brainKey), progress.cursor, stepping.delivers));
      first = undefined;
      for (const record of records) {
        const step = yield* stepOf(parts, stepping, progress, record);
        progress = step.progress;
        if (step.end !== undefined) {
          yield* parts.brains.save(brainKey, progress);
          return step.end;
        }
        if (step.delivered === true) {
          yield* parts.brains.save(brainKey, progress);
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

function deliveredTypesOf(parts: PassParts, brainKey: string): Effect.Effect<ReadonlySet<string>> {
  return Effect.map(
    wantedTypesIn(parts.database, brainKey),
    (types) =>
      new Set([
        ...recordTypesOf([...types, ...parts.registered.flatMap((consumer) => consumer.types)]),
        ...parts.calls.flatMap((consumer) => consumer.types),
      ]),
  );
}

function steppingOf(parts: PassParts, brainKey: string, mode: Mode): Effect.Effect<Stepping> {
  return Effect.map(deliveredTypesOf(parts, brainKey), (delivers) => ({
    brainKey,
    gate: runGateOf(parts.database, brainKey),
    mode,
    delivers,
    wantsMore: () =>
      Effect.map(deliveredTypesOf(parts, brainKey), (wanted) => [...wanted].some((type) => !delivers.has(type))),
  }));
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
      const glance = yield* parts.records.after(brainOfKey(brainKey), followed.cursor, noRecordTypes);
      if (glance.records.length === 0 && !glance.hasMore) {
        return 'caught_up';
      }
      const stepping = yield* steppingOf(parts, brainKey, mode);
      return yield* pagesPassed(parts, stepping, followed, stepping.delivers.size === 0 ? glance : undefined);
    });
}
