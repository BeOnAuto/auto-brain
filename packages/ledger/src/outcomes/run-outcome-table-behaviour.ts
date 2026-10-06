import type { RunOutcomeMapping } from '@beonauto/operations';
import { runFacts, runTallies } from '@beonauto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { began, ended, fourRuns, fourRunsKept, noting, reading, runsOf } from './run-outcomes-behaviour.ts';

const breakingDown = 'The mapping broke down';

const failingOnAFailure: RunOutcomeMapping = {
  ...runTallies,
  rowAfter: (row, event) => {
    const kept = runTallies.rowAfter(row, event);
    if (kept?.status === 'failed') {
      throw new Error(breakingDown);
    }
    return kept;
  },
};

function tablesIn(entry: LedgerEntry, database: string): Promise<readonly unknown[]> {
  return entry.queried(database, entry.outcomeTables);
}

async function manyRuns(entry: LedgerEntry, database: string, count: number): Promise<void> {
  const ledger = await aLedger(entry, database);
  await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: count }, (_, index) => index),
      (index) => ledger.execute(`brain/acme/alpha/executions/many-${index}`, runFacts, [began('many')]),
      { concurrency: 8, discard: true },
    ),
  );
}

function aProjectionThatBreaksDown(entry: LedgerEntry): void {
  describe('a projection that breaks down inside an append', () => {
    it('fails the append, which keeps nothing, the row it changed before included', async () => {
      const ledger = await aLedger(entry, undefined, failingOnAFailure);
      await noting(ledger, 'brain/acme/alpha/executions/r1', began('triage'));

      await expect(
        noting(ledger, 'brain/acme/alpha/executions/r1', ended('succeeded', 1), ended('failed', 2)),
      ).rejects.toThrow(breakingDown);
      await expect(
        noting(ledger, 'brain/acme/alpha/executions/r2', began('triage'), ended('failed', 2)),
      ).rejects.toThrow(breakingDown);

      expect(runsOf(await reading(ledger))).toEqual(['2026-10-01 triage started 1']);
      expect(await Effect.runPromise(ledger.load('brain/acme/alpha/executions/r2', runFacts))).toEqual({
        state: null,
        version: 0,
      });
    });
  });
}

function aStoreWithoutTheProjection(entry: LedgerEntry): void {
  describe('a ledger opened without the projection', () => {
    it('neither creates the table nor changes it', async () => {
      const database = await entry.aDatabase();
      const keeping = await aLedger(entry, database, runTallies);
      await noting(keeping, 'brain/acme/alpha/executions/r1', began('triage'));
      const fresh = await entry.aDatabase();
      await aLedger(entry, fresh);

      const without = await aLedger(entry, database);
      await noting(without, 'brain/acme/alpha/executions/r1', ended('succeeded', 5));

      expect(runsOf(await reading(keeping))).toEqual(['2026-10-01 triage started 1']);
      expect(await tablesIn(entry, fresh)).toEqual([]);
    });
  });
}

function aNewTableVersion(entry: LedgerEntry): void {
  describe('a table of the outcomes of runs that is not there yet', () => {
    it(
      'is filled when the ledger opens, from every run stream, as the projection keeps it, and earlier versions dropped',
      { timeout: 60_000 },
      async () => {
        const database = await entry.aDatabase();
        const writing = await aLedger(entry, database);
        await fourRuns(writing);
        await noting(writing, 'brain/acme/alpha/executions/r6', ended('failed', 1), { type: 'run_noted' });
        await noting(writing, 'brain/acme/alpha/executions/r7/nested', began('triage'));
        await noting(writing, 'brain/acme/alpha/executions/r8', { type: 'run_noted' });
        await manyRuns(entry, database, 1000);
        await entry.queried(database, 'CREATE TABLE run_outcomes_0 (brain_key text)');

        const filled = await aLedger(entry, database, runTallies);

        expect((await reading(filled, { from: '2026-10-01', to: '2026-10-02' }, { name: 'triage' })).length).toBe(2);
        expect(await reading(filled, { from: '2026-10-01', to: '2026-10-02' }, { name: 'many' })).toMatchObject([
          { runs: 1000 },
        ]);
        expect((await reading(filled)).filter(({ name }) => name !== 'many')).toEqual(fourRunsKept);
        expect(await tablesIn(entry, database)).toEqual([{ name: 'run_outcomes_1' }]);
      },
    );
  });
}

function aFillInterruptedOrDone(entry: LedgerEntry): void {
  describe('a fill of the table of the outcomes of runs', () => {
    it('is done again at the next open when it was interrupted, which left nothing behind', async () => {
      const database = await entry.aDatabase();
      await fourRuns(await aLedger(entry, database));
      await noting(
        await aLedger(entry, database),
        'brain/acme/alpha/executions/r5',
        began('triage'),
        ended('failed', 1),
      );

      await expect(openLedgerWith(entry.ledgerOn(database, failingOnAFailure))).rejects.toThrow(breakingDown);
      const tablesAfterTheInterruption = await tablesIn(entry, database);
      const filled = await aLedger(entry, database, runTallies);

      expect(tablesAfterTheInterruption).toEqual([]);
      expect(runsOf(await reading(filled))).toEqual([
        '2026-10-01 triage failed 1',
        '2026-10-01 triage rejected 1',
        '2026-10-01 triage succeeded 2',
        '2026-10-02 draft started 1',
      ]);
    });

    it('is not done again by a ledger that finds the table', async () => {
      const database = await entry.aDatabase();
      await fourRuns(await aLedger(entry, database, runTallies));
      await entry.queried(database, "DELETE FROM run_outcomes_1 WHERE run_id = 'r4'");

      const reopened = await aLedger(entry, database, runTallies);

      expect(runsOf(await reading(reopened))).toEqual([
        '2026-10-01 triage rejected 1',
        '2026-10-01 triage succeeded 2',
      ]);
    });
  });
}

export function runOutcomeTableBehaviour(entry: LedgerEntry): void {
  aProjectionThatBreaksDown(entry);
  aStoreWithoutTheProjection(entry);
  aNewTableVersion(entry);
  aFillInterruptedOrDone(entry);
}
