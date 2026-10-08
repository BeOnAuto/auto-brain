import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import {
  alpha,
  eventTrigger,
  published,
  recorded,
  runRecorded,
  specRecorded,
} from '../reaction-testing/brain-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../reaction-testing/until.ts';

const succeeded = { type: 'execution_succeeded' };

const told = { type: 'com.acme.told' };

const RefusalRow = Schema.Struct({ workflow: Schema.String, reason: Schema.String });

async function startsOnceTheSentinelPassed(reacting: ReactingHost) {
  const sentinel = eventTrigger({ type: 'com.acme.sentinel' });
  await specRecorded(reacting.database.store, { name: 'watch', version: 1, triggers: [sentinel] });
  await published(reacting.database.store, { id: 'sentinel', type: 'com.acme.sentinel' });
  return until(
    () => Promise.resolve(reacting.reactions.starts()),
    (starts) => starts.some(({ workflow }) => workflow === 'watch'),
  );
}

function emittedBy(executionId: string, workflow: string, depth: number) {
  return { emitted_by: { execution_id: executionId, workflow, version: 1 }, depth };
}

describe('a workflow that reacts to the facts of the brain', () => {
  it('starts on the success of another run, with the fact as its input and one more reaction depth', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await specRecorded(store, { name: 'follow', version: 1, triggers: [eventTrigger(succeeded)] });

    await runRecorded(
      store,
      { executionId: 'r-sum', primitive: 'inference', name: 'sum', depth: 2 },
      'execution_succeeded',
    );
    const starts = await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (found) => found.length > 0,
    );

    expect(starts).toMatchObject([
      {
        workflow: 'follow',
        depth: 3,
        input: [
          {
            type: 'execution_succeeded',
            source: '/executions/r-sum',
            subject: 'inference/sum',
            data: { output: 'done', depth: 2 },
          },
        ],
      },
    ]);
  });
});

describe('a workflow and its own runs', () => {
  it('never reacts to facts about its runs, nor about runs one of its runs started, nor to events its runs emitted', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await specRecorded(store, { name: 'follow', version: 1, triggers: [eventTrigger(succeeded, told)] });

    await runRecorded(
      store,
      { executionId: 'r-own', primitive: 'orchestration', name: 'follow' },
      'execution_succeeded',
    );
    await runRecorded(store, { executionId: 'r-top', primitive: 'orchestration', name: 'follow' });
    const nested = { executionId: 'r-nested', primitive: 'inference', name: 'sum', correlation: 'r-top' };
    await runRecorded(store, nested, 'execution_succeeded');
    await published(store, { id: 'told', type: 'com.acme.told' }, emittedBy('r-top', 'follow', 1));
    const starts = await startsOnceTheSentinelPassed(reacting);

    expect(starts.map(({ workflow }) => workflow)).toEqual(['watch']);
  });
});

describe('a chain of reactions', () => {
  it('stops at a reaction depth of 8: a match past it starts nothing and is refused', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await specRecorded(store, { name: 'deep', version: 1, triggers: [eventTrigger(told)] });

    await published(store, { id: 'eighth', type: 'com.acme.told' }, emittedBy('r1', 'other', 8));
    await published(store, { id: 'ninth', type: 'com.acme.told' }, emittedBy('r2', 'other', 9));
    const starts = await startsOnceTheSentinelPassed(reacting);
    const refusals = await Effect.runPromise(
      rowsOf(RefusalRow, reacting.database.read(statement`SELECT workflow, reason FROM workflow_reaction_refusals`)),
    );

    expect(starts.map(({ workflow, depth }) => [workflow, depth])).toEqual([
      ['deep', 8],
      ['watch', 1],
    ]);
    expect(refusals).toEqual([
      {
        workflow: 'deep',
        reason:
          'An event matched the event trigger of the workflow at reaction depth 9, past the 8 a chain of reactions may reach',
      },
    ]);
  });
});

describe('a brain whose run log holds a record its dispatch never covers', () => {
  it(
    'passes the record at the twentieth sweep, says so, and goes on to the events after it',
    { timeout: 30_000 },
    async () => {
      const reacting = await reactingHost({ sweepEveryMs: 10 });
      const { store } = reacting.database;
      await specRecorded(store, { name: 'close', version: 1, triggers: [eventTrigger({ type: 'com.acme.closed' })] });
      await recorded(store, `${alpha}runs/r-stuck`, {
        type: 'input_applied',
        input: {},
        at: '2026-10-01T09:00:00.000Z',
      });
      await published(store, { id: 'closed', type: 'com.acme.closed' });

      const starts = await until(
        () => Promise.resolve(reacting.reactions.starts()),
        (found) => found.length > 0,
        2000,
      );

      expect(starts.map(({ workflow }) => workflow)).toEqual(['close']);
      expect(reacting.notes()).toMatchObject([
        {
          kind: 'run_record_passed',
          run: { org: 'acme', brain: 'alpha', executionId: 'r-stuck' },
          version: 1,
          sweeps: 20,
        },
      ]);
    },
  );
});
