import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { at, specRecorded } from '../reaction-testing/brain-writes.ts';
import { movedClock, type MovedClock } from '../reaction-testing/moved-clock.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../reaction-testing/until.ts';
import { reactionExecutionIdOf } from '../reactions/reaction-ids.ts';

const activatedAt = Date.parse(at);

const aMinute = 60_000;

const RefusalRow = Schema.Struct({ reason: Schema.String });

interface Ticking {
  readonly reacting: ReactingHost;
  readonly clock: MovedClock;
}

function isoAt(minutes: number): string {
  return new Date(activatedAt + minutes * aMinute).toISOString();
}

async function ticking(refusesStarts = () => false): Promise<Ticking> {
  const clock = movedClock(activatedAt + 1000);
  const reacting = await reactingHost({ clock, refusesStarts });
  await specRecorded(reacting.database.store, {
    name: 'tick',
    version: 1,
    trigger: { kind: 'every', milliseconds: aMinute },
  });
  return { reacting, clock };
}

async function startsReaching(reacting: ReactingHost, count: number) {
  const starts = await until(
    () => Promise.resolve(reacting.reactions.starts()),
    (found) => found.length >= count,
  );
  return [...starts];
}

function refusalsOf(reacting: ReactingHost) {
  return until(
    () =>
      Effect.runPromise(
        rowsOf(RefusalRow, reacting.database.read(statement`SELECT reason FROM workflow_reaction_refusals`)),
      ),
    (found) => found.length > 0,
  );
}

describe('a workflow whose trigger is a schedule every minute', () => {
  it('is started at each due time, anchored at its activation, under an id of its due time, with the schedule as input', async () => {
    const { reacting, clock } = await ticking();

    clock.moveTo(activatedAt + aMinute);
    const first = await startsReaching(reacting, 1);
    clock.moveTo(activatedAt + 2 * aMinute + 30_000);
    const both = await startsReaching(reacting, 2);

    expect(first).toEqual([
      {
        org: 'acme',
        brain: 'alpha',
        workflow: 'tick',
        version: 1,
        executionId: reactionExecutionIdOf('tick', 1, isoAt(1)),
        input: { schedule: { due: isoAt(1) } },
        depth: 1,
        cause: null,
      },
    ]);
    expect(both.map(({ input }) => input)).toEqual([{ schedule: { due: isoAt(1) } }, { schedule: { due: isoAt(2) } }]);
  });
});

describe('the due times of a schedule', () => {
  it('are skipped while the run of the time before still runs, and the skip is said', async () => {
    const { reacting, clock } = await ticking();
    clock.moveTo(activatedAt + aMinute);
    await startsReaching(reacting, 1);
    const running = `acme/alpha/${reactionExecutionIdOf('tick', 1, isoAt(1))}`;
    await Effect.runPromise(
      reacting.database.write(statement`INSERT INTO workflow_runs (run_id, stream_id) VALUES (${running}, ${'s'})`),
    );

    clock.moveTo(activatedAt + 2 * aMinute);
    const refusals = await refusalsOf(reacting);

    await Effect.runPromise(
      reacting.database.write(statement`UPDATE workflow_runs SET ended_at = 3 WHERE run_id = ${running}`),
    );
    clock.moveTo(activatedAt + 3 * aMinute);
    const starts = await startsReaching(reacting, 2);

    expect([starts.map(({ input }) => input), refusals]).toEqual([
      [{ schedule: { due: isoAt(1) } }, { schedule: { due: isoAt(3) } }],
      [{ reason: `The run due at ${isoAt(2)} was skipped: the run of the time before still runs` }],
    ]);
  });
});

describe('a due time of a schedule', () => {
  it('whose run the brain refuses is said, and the schedule goes on', async () => {
    const refusing = { now: true };
    const { reacting, clock } = await ticking(() => refusing.now);
    clock.moveTo(activatedAt + aMinute);
    const refusals = await refusalsOf(reacting);
    refusing.now = false;

    clock.moveTo(activatedAt + 2 * aMinute);
    const starts = await startsReaching(reacting, 1);

    expect([refusals, starts.map(({ input }) => input)]).toEqual([
      [{ reason: `The run due at ${isoAt(1)} could not be started: The brain refused the start` }],
      [{ schedule: { due: isoAt(2) } }],
    ]);
  });

  it('missed while the server was down runs only the latest, and the missed ones are said', async () => {
    const { reacting, clock } = await ticking();

    clock.moveTo(activatedAt + 5 * aMinute + 10_000);
    const starts = await startsReaching(reacting, 1);
    const refusals = await refusalsOf(reacting);

    expect([starts.map(({ input }) => input), refusals]).toEqual([
      [{ schedule: { due: isoAt(5) } }],
      [
        {
          reason: `The runs due from ${isoAt(1)} to ${isoAt(5)} came while the server was down, and only the latest ran`,
        },
      ],
    ]);
  });
});

describe('a workflow whose trigger is a cron schedule', () => {
  it('is started at the times of its five fields, in UTC', async () => {
    const clock = movedClock(activatedAt + 1000);
    const reacting = await reactingHost({ clock });
    await specRecorded(reacting.database.store, {
      name: 'nightly',
      version: 1,
      trigger: { kind: 'cron', expression: '30 2 * * *' },
    });

    clock.moveTo(Date.parse('2026-10-02T02:30:00.000Z'));
    const starts = await startsReaching(reacting, 1);

    expect(starts.map(({ input }) => input)).toEqual([{ schedule: { due: '2026-10-02T02:30:00.000Z' } }]);
  });
});
