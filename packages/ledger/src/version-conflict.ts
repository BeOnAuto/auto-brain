import { Conflict } from '@beonauto/operations';
import { Data, Effect } from 'effect';

export class VersionConflict extends Data.TaggedError('version_conflict') {}

const retriesOnVersionConflict = 3;

const changedWhileDeciding = 'The state changed while the command was decided';

export function retriedOnVersionConflict<A>(attempt: Effect.Effect<A, VersionConflict>): Effect.Effect<A, Conflict> {
  return attempt.pipe(
    Effect.retry({ times: retriesOnVersionConflict }),
    Effect.mapError(() => new Conflict({ detail: changedWhileDeciding, kind: 'concurrent_change' })),
  );
}
