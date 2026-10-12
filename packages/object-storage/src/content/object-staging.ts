import {
  leftUnread,
  stagingEnded,
  type BrainAddress,
  type ContentKept,
  type ContentRefused,
  type ContentToKeep,
  type StagingEnded,
} from '@beonauto/operations';
import { Effect } from 'effect';

import { heldAt, keysUnder, marked, removed } from './bucket-requests.ts';
import { placedOn, type Placing } from './object-writes.ts';

interface StagedRun {
  readonly brain: BrainAddress;
  readonly run: string;
}

function endedOf({ bucket, keys }: Placing, { brain, run }: StagedRun): Effect.Effect<boolean> {
  return Effect.promise(async () => (await heldAt(bucket, keys.ended(brain, run))) !== undefined);
}

function stagingOpen(placing: Placing, staged: StagedRun): Effect.Effect<void, StagingEnded> {
  return Effect.flatMap(endedOf(placing, staged), (ended) =>
    ended ? Effect.fail(stagingEnded(staged.run)) : Effect.void,
  );
}

export function stagedOn(
  placing: Placing,
  staged: StagedRun,
  content: ContentToKeep,
): Effect.Effect<ContentKept, ContentRefused | StagingEnded> {
  const { bucket, keys } = placing;
  const { brain, run } = staged;
  return Effect.gen(function* () {
    yield* stagingOpen(placing, staged).pipe(Effect.tapError(() => leftUnread(content.stream)));
    const kept = yield* placedOn(placing, (sha256) => keys.staged(brain, run, sha256), content);
    if (yield* endedOf(placing, staged)) {
      yield* Effect.promise(() => removed(bucket, [keys.staged(brain, run, kept.sha256)]));
      return yield* Effect.fail(stagingEnded(run));
    }
    return kept;
  });
}

export async function unstagedOn({ bucket, keys }: Placing, { brain, run }: StagedRun): Promise<void> {
  const ended = keys.ended(brain, run);
  await marked(bucket, ended);
  const staged: string[] = [];
  for await (const key of keysUnder(bucket, keys.run(brain, run))) {
    if (key !== ended) {
      staged.push(key);
    }
  }
  await removed(bucket, staged);
}
