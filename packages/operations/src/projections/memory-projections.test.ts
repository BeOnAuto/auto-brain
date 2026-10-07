import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { messageIdOf, projectedTableOf, type ProjectedRowsQuery, type RunProjection } from '../index.ts';
import { runFacts, type RunFact } from '../run-outcomes/run-tallies.ts';
import { memoryLedger, type MemoryLedger } from '../testing/memory-ledger.ts';
import { runTallyRows, tallyDueAfterMs, tallyRowsOf } from './tally-rows.ts';

const alpha = { org: 'acme', brain: 'alpha' };

const nine = Date.parse('2026-10-01T09:00:00.000Z');

function noting(ledger: MemoryLedger, stream: string, ...facts: readonly RunFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.service.execute(stream, runFacts, facts));
}

function began(fn: string, minute = 0): RunFact {
  return { type: 'run_began', at: new Date(nine + minute * 60_000).toISOString(), fn };
}

const ended: RunFact = { type: 'run_ended', status: 'succeeded', ms: 10, tokens: null };

const newestFirst: ProjectedRowsQuery = { where: [], orderBy: ['began_at'], order: 'desc', limit: 10 };

function read(ledger: MemoryLedger, query: ProjectedRowsQuery = newestFirst) {
  return Effect.runPromise(ledger.service.readProjectedRows('run_tallies', alpha, query));
}

describe('a projection of runs in the in-memory ledger', () => {
  it('keeps one row a run from the facts of its types, with the id of the message it last took', async () => {
    const ledger = memoryLedger(undefined, [runTallyRows]);
    await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage'), { type: 'run_noted' });
    await noting(ledger, 'brain/acme/alpha/executions/r1', ended);
    await noting(ledger, 'brain/acme/alpha/runs/r1', began('ignored'));

    expect(await read(ledger)).toEqual([
      {
        org: 'acme',
        brain: 'alpha',
        runId: 'r1',
        row: {
          fn: 'triage',
          began_at: nine,
          status: 'succeeded',
          facts: 3,
          open: false,
          due_at: null,
          last_message: messageIdOf('brain/acme/alpha/executions/r1', 3),
        },
      },
    ]);
  });
});

describe('a read of the rows of a projection in the in-memory ledger', () => {
  it('reads the rows of one brain by their columns, in order, from where a page ended', async () => {
    const ledger = memoryLedger(undefined, [runTallyRows]);
    await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage', 0));
    await noting(ledger, 'brain/acme/alpha/executions/r2', began('triage', 1), ended);
    await noting(ledger, 'brain/acme/alpha/executions/r3', began('review', 2));
    await noting(ledger, 'brain/acme/beta/executions/r4', began('triage', 3));

    const runsOf = async (query: ProjectedRowsQuery) => (await read(ledger, query)).map(({ runId }) => runId);
    const open = { column: 'open', equals: true };

    expect(await runsOf(newestFirst)).toEqual(['r3', 'r2', 'r1']);
    expect(await runsOf({ ...newestFirst, order: 'asc' })).toEqual(['r1', 'r2', 'r3']);
    expect(await runsOf({ ...newestFirst, where: [open] })).toEqual(['r3', 'r1']);
    expect(await runsOf({ ...newestFirst, where: [open, { column: 'fn', equals: 'triage' }] })).toEqual(['r1']);
    expect(await runsOf({ ...newestFirst, limit: 1 })).toEqual(['r3']);
    expect(await runsOf({ ...newestFirst, after: [nine + 120_000, 'r3'] })).toEqual(['r2', 'r1']);
    expect(await Effect.runPromise(ledger.service.countProjectedRows('run_tallies', alpha, [open]))).toBe(2);
    expect(await Effect.runPromise(ledger.service.countProjectedRows('nothing', alpha, []))).toBe(0);
  });

  it('reads the rows due by a time across brains, the soonest first, and the next due time', async () => {
    const ledger = memoryLedger(undefined, [runTallyRows]);
    await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage', 2));
    await noting(ledger, 'brain/globex/gamma/executions/r2', began('triage', 0));
    await noting(ledger, 'brain/acme/beta/executions/r3', began('triage', 1), ended);
    const due = (through: number, limit = 10) =>
      Effect.runPromise(ledger.service.readDueRows('run_tallies', { column: 'due_at', through, limit }));

    expect((await due(nine + 3 * 60_000)).map(({ org, brain, runId }) => `${org}/${brain}/${runId}`)).toEqual([
      'globex/gamma/r2',
      'acme/alpha/r1',
    ]);
    expect((await due(nine + tallyDueAfterMs)).map(({ runId }) => runId)).toEqual(['r2']);
    expect((await due(nine + 3 * 60_000, 1)).map(({ runId }) => runId)).toEqual(['r2']);
    expect(await Effect.runPromise(ledger.service.nextDueOf('run_tallies', 'due_at'))).toBe(nine + tallyDueAfterMs);
    expect(await Effect.runPromise(ledger.service.nextDueOf('nothing', 'due_at'))).toBeNull();
  });
});

describe('an append to a run of which a projection keeps a row, in the in-memory ledger', () => {
  it('keeps nothing of an append whose projection breaks down, and records nothing of it', async () => {
    const breaking: RunProjection = tallyRowsOf(1, (row) => row['status'] !== 'started');
    const ledger = memoryLedger(undefined, [breaking]);
    await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage'));

    const failed = await Effect.runPromiseExit(
      ledger.service.execute('brain/acme/alpha/executions/r1', runFacts, [ended]),
    );

    expect(Exit.isFailure(failed)).toBe(true);
    expect((await read(ledger)).map(({ row }) => row['status'])).toEqual(['started']);
    expect((await Effect.runPromise(ledger.service.load('brain/acme/alpha/executions/r1', runFacts))).version).toBe(1);
  });

  it('keeps nothing for a run whose facts its mapping does not take', async () => {
    const ledger = memoryLedger(undefined, [runTallyRows]);
    await noting(ledger, 'brain/acme/alpha/executions/r1', ended, { type: 'run_noted' });

    expect(await read(ledger)).toEqual([]);
  });

  it('hands its mapping only the facts of the types it names', async () => {
    const ledger = memoryLedger(undefined, [{ ...runTallyRows, types: ['run_began', 'run_ended'] }]);
    await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage'), { type: 'run_noted' });

    expect((await read(ledger)).map(({ row }) => row['facts'])).toEqual([1]);
  });

  it('orders a column that is not set before every value that is', async () => {
    const ledger = memoryLedger(undefined, [runTallyRows]);
    await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage', 0));
    await noting(ledger, 'brain/acme/alpha/executions/r2', began('triage', 1), ended);
    const byDue = { where: [], orderBy: ['due_at'], limit: 10 };

    expect((await read(ledger, { ...byDue, order: 'asc' })).map(({ runId }) => runId)).toEqual(['r2', 'r1']);
    expect((await read(ledger, { ...byDue, order: 'desc' })).map(({ runId }) => runId)).toEqual(['r1', 'r2']);
  });
});

describe('the table of a projection', () => {
  it('is named for the projection and its version, so a new version is a new table', () => {
    expect([projectedTableOf(runTallyRows), projectedTableOf(tallyRowsOf(2))]).toEqual([
      'run_tallies_1',
      'run_tallies_2',
    ]);
  });
});

describe('a projection declared with names a table cannot hold', () => {
  const malformed: readonly (readonly [string, RunProjection])[] = [
    ['The projection name Tallies is malformed', { ...runTallyRows, name: 'Tallies' }],
    ['The projection run_tallies has a version that is not a whole number from 1', { ...runTallyRows, version: 0 }],
    ['The column name Fn is malformed', { ...runTallyRows, columns: [{ name: 'Fn', kind: 'text' }] }],
    [
      'The projection run_tallies may not name a column run_id, which keys every row',
      { ...runTallyRows, columns: [{ name: 'run_id', kind: 'text' }] },
    ],
    [
      'The index name By-status is malformed',
      { ...runTallyRows, indexes: [{ name: 'By-status', columns: ['status'] }] },
    ],
    [
      'The projection run_tallies has no column state',
      { ...runTallyRows, indexes: [{ name: 'by_state', columns: ['state'] }] },
    ],
    [
      'The projection run_tallies has no column due',
      { ...runTallyRows, indexes: [{ name: 'due', columns: ['due_at'], whereSet: 'due' }] },
    ],
  ];

  it.each(malformed)('is refused: %s', (message, projection) => {
    expect(() => memoryLedger(undefined, [projection])).toThrow(message);
  });
});
