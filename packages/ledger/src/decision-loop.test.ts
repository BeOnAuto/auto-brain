import { Conflict } from '@beonauto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { decisionLoop, VersionConflict, type DecisionLoop } from './index.ts';
import { outcomeOf } from './testing/open-ledger.ts';
import { tally, type Amounts } from './testing/tally.ts';

interface Loaded {
  readonly state: number;
  readonly version: number;
  readonly loadedFrom: string;
}

interface Appended {
  readonly stream: string;
  readonly events: readonly unknown[];
  readonly expectedVersion: number;
}

interface Counted {
  readonly type: 'counted';
  readonly by: number;
}

interface Loop {
  readonly loop: DecisionLoop<Loaded, number, Amounts, Counted, 'conflict'>;
  readonly appended: readonly Appended[];
}

function loopOver(loaded: Loaded, conflicts: number): Loop {
  const appended: Appended[] = [];
  let remaining = conflicts;
  const loop = decisionLoop(
    () => Effect.succeed(loaded),
    (stream, events, expectedVersion) =>
      Effect.suspend(() => {
        remaining -= 1;
        appended.push({ stream, events, expectedVersion });
        return remaining >= 0 ? Effect.fail(new VersionConflict()) : Effect.void;
      }),
    tally,
  );
  return { loop, appended };
}

const snapshotted: Loaded = { state: 40, version: 7, loadedFrom: 'a snapshot and two events' };

describe('the decision loop over any store', () => {
  it('decides on what its load gave, appends with that version expected, and gives the load back with the events', async () => {
    const { loop, appended } = loopOver(snapshotted, 0);

    expect(await Effect.runPromise(loop('run/1', [1, 1]))).toEqual({
      loaded: snapshotted,
      events: [
        { type: 'counted', by: 1 },
        { type: 'counted', by: 1 },
      ],
      state: 42,
      version: 9,
    });
    expect(appended).toEqual([
      {
        stream: 'run/1',
        events: [
          { type: 'counted', by: 1 },
          { type: 'counted', by: 1 },
        ],
        expectedVersion: 7,
      },
    ]);
  });

  it('loads and decides again after a version conflict, and fails with Conflict after three more attempts', async () => {
    const { loop, appended } = loopOver(snapshotted, 4);

    expect(await outcomeOf(loop('run/1', [1]))).toEqual(
      Result.fail(
        new Conflict({ detail: 'The state changed while the command was decided', kind: 'concurrent_change' }),
      ),
    );
    expect(appended).toHaveLength(4);
  });
});
