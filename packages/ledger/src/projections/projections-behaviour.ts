import { messageIdOf, type Ledger, type ProjectedRowsQuery, type RunProjection } from '@beonauto/operations';
import { runFacts, runTallyRows, tallyDueAfterMs, type RunFact } from '@beonauto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

type AnyLedger = Ledger['Service'];

export type ProjectingLedger = (projections: readonly RunProjection[]) => Promise<AnyLedger>;

const alpha = { org: 'acme', brain: 'alpha' };

const nine = Date.parse('2026-10-01T09:00:00.000Z');

const minute = 60_000;

const ended: RunFact = { type: 'run_ended', status: 'succeeded', ms: 10, tokens: null };

const newestFirst: ProjectedRowsQuery = { where: [], orderBy: ['began_at'], order: 'desc', limit: 10 };

function noting(ledger: AnyLedger, stream: string, ...facts: readonly RunFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, runFacts, facts));
}

function began(fn: string, minutes = 0): RunFact {
  return { type: 'run_began', at: new Date(nine + minutes * minute).toISOString(), fn };
}

async function runsOf(ledger: AnyLedger, query: ProjectedRowsQuery = newestFirst): Promise<readonly string[]> {
  return (await Effect.runPromise(ledger.readProjectedRows('run_tallies', alpha, query))).map(({ runId }) => runId);
}

const twoRowsKept = [
  {
    org: 'acme',
    brain: 'alpha',
    runId: 'r2',
    row: {
      fn: 'review',
      began_at: nine + minute,
      status: 'started',
      facts: 1,
      open: true,
      due_at: nine + minute + tallyDueAfterMs,
      last_message: messageIdOf('brain/acme/alpha/executions/r2', 1),
    },
  },
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
];

function rowsKept(open: ProjectingLedger): void {
  describe('a projection of runs', () => {
    it('keeps one row a run, the id of the message it last took among them, and its values as they were', async () => {
      const ledger = await open([runTallyRows]);
      await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage'), { type: 'run_noted' });
      await noting(ledger, 'brain/acme/alpha/executions/r1', ended);
      await noting(ledger, 'brain/acme/alpha/executions/r2', began('review', 1));
      await noting(ledger, 'brain/acme/alpha/runs/r3', began('ignored'));

      expect(await Effect.runPromise(ledger.readProjectedRows('run_tallies', alpha, newestFirst))).toEqual(twoRowsKept);
    });

    it('answers nothing of a projection it does not keep', async () => {
      const ledger = await open([]);
      await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage'));

      expect(await runsOf(ledger)).toEqual([]);
      expect(await Effect.runPromise(ledger.countProjectedRows('run_tallies', alpha, []))).toBe(0);
      expect(
        await Effect.runPromise(ledger.readDueRows('run_tallies', { column: 'due_at', through: nine, limit: 1 })),
      ).toEqual([]);
      expect(await Effect.runPromise(ledger.nextDueOf('run_tallies', 'due_at'))).toBeNull();
    });
  });
}

function rowsOfABrain(open: ProjectingLedger): void {
  describe('a read of the rows of a brain', () => {
    it('reads by columns, in order either way, from where a page ended, and counts them', async () => {
      const ledger = await open([runTallyRows]);
      await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage', 0));
      await noting(ledger, 'brain/acme/alpha/executions/r2', began('triage', 1), ended);
      await noting(ledger, 'brain/acme/alpha/executions/r3', began('review', 2));
      await noting(ledger, 'brain/acme/beta/executions/r4', began('triage', 3));
      const stillOpen = { column: 'open', equals: true };

      expect(await runsOf(ledger)).toEqual(['r3', 'r2', 'r1']);
      expect(await runsOf(ledger, { ...newestFirst, order: 'asc' })).toEqual(['r1', 'r2', 'r3']);
      expect(await runsOf(ledger, { ...newestFirst, where: [stillOpen] })).toEqual(['r3', 'r1']);
      expect(await runsOf(ledger, { ...newestFirst, where: [stillOpen, { column: 'fn', equals: 'triage' }] })).toEqual([
        'r1',
      ]);
      expect(await runsOf(ledger, { ...newestFirst, limit: 2 })).toEqual(['r3', 'r2']);
      expect(await runsOf(ledger, { ...newestFirst, after: [nine + 2 * minute, 'r3'] })).toEqual(['r2', 'r1']);
      expect(await runsOf(ledger, { ...newestFirst, order: 'asc', after: [nine, 'r1'] })).toEqual(['r2', 'r3']);
      expect(await Effect.runPromise(ledger.countProjectedRows('run_tallies', alpha, [stillOpen]))).toBe(2);
    });

    it('orders a column that is not set before every value that is', async () => {
      const ledger = await open([runTallyRows]);
      await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage', 0));
      await noting(ledger, 'brain/acme/alpha/executions/r2', began('triage', 1), ended);
      const byDue = { where: [], orderBy: ['due_at'], limit: 10 };

      expect(await runsOf(ledger, { ...byDue, order: 'asc' })).toEqual(['r2', 'r1']);
      expect(await runsOf(ledger, { ...byDue, order: 'desc' })).toEqual(['r1', 'r2']);
    });
  });
}

function dueRows(open: ProjectingLedger): void {
  describe('a read of the rows due by a time', () => {
    it('reads the rows of every brain whose time is set and has come, the soonest first, and the next time', async () => {
      const ledger = await open([runTallyRows]);
      await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage', 2));
      await noting(ledger, 'brain/globex/gamma/executions/r2', began('triage', 0));
      await noting(ledger, 'brain/acme/beta/executions/r3', began('triage', 1), ended);
      const due = async (through: number, limit = 10) =>
        (await Effect.runPromise(ledger.readDueRows('run_tallies', { column: 'due_at', through, limit }))).map(
          ({ org, brain, runId }) => `${org}/${brain}/${runId}`,
        );

      expect(await due(nine + 3 * minute)).toEqual(['globex/gamma/r2', 'acme/alpha/r1']);
      expect(await due(nine + tallyDueAfterMs)).toEqual(['globex/gamma/r2']);
      expect(await due(nine + 3 * minute, 1)).toEqual(['globex/gamma/r2']);
      expect(await due(nine)).toEqual([]);
      expect(await Effect.runPromise(ledger.nextDueOf('run_tallies', 'due_at'))).toBe(nine + tallyDueAfterMs);
    });
  });
}

export function projectionsBehaviour(open: ProjectingLedger): void {
  rowsKept(open);
  rowsOfABrain(open);
  dueRows(open);
}
