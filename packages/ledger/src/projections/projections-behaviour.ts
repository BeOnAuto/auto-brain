import { messageIdOf, type KeyedProjection, type Ledger, type ProjectedRowsQuery } from '@beonauto/operations';
import {
  runFacts,
  runTallyRows,
  tallyDueAfterMs,
  topicFacts,
  topicRows,
  topicWaitMs,
  type RunFact,
  type TopicFact,
} from '@beonauto/operations/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

type AnyLedger = Ledger['Service'];

export type ProjectingLedger = (projections: readonly KeyedProjection[]) => Promise<AnyLedger>;

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
  return (await Effect.runPromise(ledger.readProjectedRows('run_tallies', alpha, query))).map(({ key }) => key);
}

const twoRowsKept = [
  {
    org: 'acme',
    brain: 'alpha',
    key: 'r2',
    row: {
      fn: 'review',
      began_at: nine + minute,
      status: 'started',
      facts: 1,
      open: true,
      due_at: nine + minute + tallyDueAfterMs,
      last_message: messageIdOf('brain/acme/alpha/runs/r2', 1),
    },
  },
  {
    org: 'acme',
    brain: 'alpha',
    key: 'r1',
    row: {
      fn: 'triage',
      began_at: nine,
      status: 'succeeded',
      facts: 3,
      open: false,
      due_at: null,
      last_message: messageIdOf('brain/acme/alpha/runs/r1', 3),
    },
  },
];

function rowsKept(open: ProjectingLedger): void {
  describe('a projection of runs', () => {
    it('keeps one row a run, the id of the message it last took among them, and its values as they were', async () => {
      const ledger = await open([runTallyRows]);
      await noting(ledger, 'brain/acme/alpha/runs/r1', began('triage'), { type: 'run_noted' });
      await noting(ledger, 'brain/acme/alpha/runs/r1', ended);
      await noting(ledger, 'brain/acme/alpha/runs/r2', began('review', 1));
      await noting(ledger, 'brain/acme/alpha/run-logs/r3', began('ignored'));
      await noting(ledger, 'brain/acme/alpha/runs', began('ignored'));

      expect(await Effect.runPromise(ledger.readProjectedRows('run_tallies', alpha, newestFirst))).toEqual(twoRowsKept);
    });

    it('answers nothing of a projection it does not keep', async () => {
      const ledger = await open([]);
      await noting(ledger, 'brain/acme/alpha/runs/r1', began('triage'));

      expect(await runsOf(ledger)).toEqual([]);
      expect(await Effect.runPromise(ledger.countProjectedRows('run_tallies', alpha, []))).toBe(0);
      expect(
        await Effect.runPromise(ledger.readDueRows('run_tallies', { column: 'due_at', through: nine, limit: 1 })),
      ).toEqual([]);
      expect(await Effect.runPromise(ledger.nextDueOf('run_tallies', 'due_at', 0))).toBeNull();
    });
  });
}

function rowsOfABrain(open: ProjectingLedger): void {
  describe('a read of the rows of a brain', () => {
    it('reads by columns, in order either way, from where a page ended, and counts them', async () => {
      const ledger = await open([runTallyRows]);
      await noting(ledger, 'brain/acme/alpha/runs/r1', began('triage', 0));
      await noting(ledger, 'brain/acme/alpha/runs/r2', began('triage', 1), ended);
      await noting(ledger, 'brain/acme/alpha/runs/r3', began('review', 2));
      await noting(ledger, 'brain/acme/beta/runs/r4', began('triage', 3));
      const stillOpen = { column: 'open', equals: true };

      expect(await runsOf(ledger)).toEqual(['r3', 'r2', 'r1']);
      expect(await runsOf(ledger, { ...newestFirst, order: 'asc' })).toEqual(['r1', 'r2', 'r3']);
      expect(await runsOf(ledger, { ...newestFirst, where: [stillOpen] })).toEqual(['r3', 'r1']);
      expect(await runsOf(ledger, { ...newestFirst, where: [stillOpen, { column: 'fn', equals: 'triage' }] })).toEqual([
        'r1',
      ]);
      expect(await runsOf(ledger, { ...newestFirst, where: [{ column: 'row_key', equals: 'r2' }] })).toEqual(['r2']);
      expect(await runsOf(ledger, { ...newestFirst, limit: 2 })).toEqual(['r3', 'r2']);
      expect(await runsOf(ledger, { ...newestFirst, after: [nine + 2 * minute, 'r3'] })).toEqual(['r2', 'r1']);
      expect(await runsOf(ledger, { ...newestFirst, order: 'asc', after: [nine, 'r1'] })).toEqual(['r2', 'r3']);
      expect(await Effect.runPromise(ledger.countProjectedRows('run_tallies', alpha, [stillOpen]))).toBe(2);
    });

    it('orders a column that is not set before every value that is', async () => {
      const ledger = await open([runTallyRows]);
      await noting(ledger, 'brain/acme/alpha/runs/r1', began('triage', 0));
      await noting(ledger, 'brain/acme/alpha/runs/r2', began('triage', 1), ended);
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
      await noting(ledger, 'brain/acme/alpha/runs/r1', began('triage', 2));
      await noting(ledger, 'brain/globex/gamma/runs/r2', began('triage', 0));
      await noting(ledger, 'brain/acme/beta/runs/r3', began('triage', 1), ended);
      const due = async (through: number, limit = 10) =>
        (await Effect.runPromise(ledger.readDueRows('run_tallies', { column: 'due_at', through, limit }))).map(
          ({ org, brain, key }) => `${org}/${brain}/${key}`,
        );

      expect(await due(nine + 3 * minute)).toEqual(['globex/gamma/r2', 'acme/alpha/r1']);
      expect(await due(nine + tallyDueAfterMs)).toEqual(['globex/gamma/r2']);
      expect(await due(nine + 3 * minute, 1)).toEqual(['globex/gamma/r2']);
      expect(await due(nine)).toEqual([]);
      expect(await Effect.runPromise(ledger.nextDueOf('run_tallies', 'due_at', 0))).toBe(nine + tallyDueAfterMs);
      expect(await Effect.runPromise(ledger.nextDueOf('run_tallies', 'due_at', nine + tallyDueAfterMs))).toBe(
        nine + 3 * minute,
      );
    });
  });
}

function topics(ledger: AnyLedger, stream: string, ...facts: readonly TopicFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, topicFacts, facts));
}

export function topicsOf(ledger: AnyLedger) {
  return Effect.runPromise(
    ledger.readProjectedRows('topics', alpha, { where: [], orderBy: [], order: 'asc', limit: 10 }),
  );
}

function rowsKeyedByTheirMapping(open: ProjectingLedger): void {
  describe('a projection keyed by what its mapping says, over the stream kinds it names', () => {
    it('keeps one row a key from every stream of its kinds, and nothing of another kind', async () => {
      const ledger = await open([topicRows]);
      await topics(ledger, 'brain/acme/alpha/runs/r1', { type: 'topic_opened', topic: 'spring', at: nine });
      await topics(ledger, 'brain/acme/alpha/notes/n1', { type: 'topic_noted', topic: 'spring', note: 'first' });
      await topics(ledger, 'brain/acme/alpha/notes/n2', { type: 'topic_noted', topic: 'autumn', note: 'none' });
      await topics(ledger, 'brain/acme/alpha/others/o1', { type: 'topic_noted', topic: 'spring', note: 'other' });

      expect(await topicsOf(ledger)).toEqual([
        {
          org: 'acme',
          brain: 'alpha',
          key: 'spring',
          row: {
            topic: 'spring',
            note: 'first',
            last_message: messageIdOf('brain/acme/alpha/notes/n1', 1),
            open: true,
            next_at: nine + topicWaitMs,
            due_at: nine + topicWaitMs,
          },
        },
      ]);
    });
  });
}

function rowsAdvanced(open: ProjectingLedger): void {
  describe('the advance of a row of a projection keyed by its mapping', () => {
    it('lets its reader advance the columns it declares, which a fold leaves as they stand unless it sets them', async () => {
      const ledger = await open([topicRows]);
      await topics(ledger, 'brain/acme/alpha/runs/r1', { type: 'topic_opened', topic: 'spring', at: nine });
      await Effect.runPromise(
        ledger.advanceRow('topics', alpha, 'spring', { set: { open: false, next_at: null, due_at: null }, when: [] }),
      );
      await topics(ledger, 'brain/acme/alpha/notes/n1', { type: 'topic_noted', topic: 'spring', note: 'after' });
      const advanced = await topicsOf(ledger);
      await topics(ledger, 'brain/acme/alpha/runs/r2', {
        type: 'topic_opened',
        topic: 'spring',
        at: nine + minute,
      });

      expect(advanced.map(({ row }) => [row['note'], row['open'], row['next_at'], row['due_at']])).toEqual([
        ['after', false, null, null],
      ]);
      expect((await topicsOf(ledger)).map(({ row }) => [row['open'], row['due_at']])).toEqual([
        [true, nine + minute + topicWaitMs],
      ]);
      expect(
        await Effect.runPromise(
          ledger.readDueRows('topics', { column: 'due_at', through: nine + 2 * minute, limit: 5 }),
        ),
      ).toMatchObject([{ key: 'spring' }]);
    });

    it('refuses to advance a column the projection does not declare, and advances no row that is not there', async () => {
      const ledger = await open([topicRows]);
      await topics(ledger, 'brain/acme/alpha/runs/r1', { type: 'topic_opened', topic: 'spring', at: nine });

      const refused = await Effect.runPromiseExit(
        ledger.advanceRow('topics', alpha, 'spring', { set: { note: 'advanced' }, when: [] }),
      );
      await Effect.runPromise(ledger.advanceRow('topics', alpha, 'autumn', { set: { open: false }, when: [] }));
      await Effect.runPromise(ledger.advanceRow('nothing', alpha, 'spring', { set: { open: false }, when: [] }));

      expect(Exit.isFailure(refused)).toBe(true);
      expect((await topicsOf(ledger)).map(({ key, row }) => [key, row['open'], row['note']])).toEqual([
        ['spring', true, null],
      ]);
    });
  });
}

function rowsAdvancedWhileUnchanged(open: ProjectingLedger): void {
  describe('the advance of a row that its fold changed since its reader read it', () => {
    it('advances a row only while the columns it is told to compare still hold what its reader read', async () => {
      const ledger = await open([topicRows]);
      await topics(ledger, 'brain/acme/alpha/runs/r1', { type: 'topic_opened', topic: 'spring', at: nine });
      const readAt = messageIdOf('brain/acme/alpha/runs/r1', 1);
      await topics(ledger, 'brain/acme/alpha/notes/n1', { type: 'topic_noted', topic: 'spring', note: 'meanwhile' });
      const folded = messageIdOf('brain/acme/alpha/notes/n1', 1);

      await Effect.runPromise(
        ledger.advanceRow('topics', alpha, 'spring', {
          set: { open: false },
          when: [{ column: 'last_message', equals: readAt }],
        }),
      );
      const kept = await topicsOf(ledger);
      await Effect.runPromise(
        ledger.advanceRow('topics', alpha, 'spring', {
          set: { open: false },
          when: [{ column: 'last_message', equals: folded }],
        }),
      );

      expect(kept.map(({ row }) => row['open'])).toEqual([true]);
      expect((await topicsOf(ledger)).map(({ row }) => row['open'])).toEqual([false]);
    });
  });
}

export function projectionsBehaviour(open: ProjectingLedger): void {
  rowsKept(open);
  rowsOfABrain(open);
  dueRows(open);
  rowsKeyedByTheirMapping(open);
  rowsAdvanced(open);
  rowsAdvancedWhileUnchanged(open);
}
