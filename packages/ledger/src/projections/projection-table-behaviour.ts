import { messageIdOf, type ProjectedRowsQuery } from '@beonauto/operations';
import { runFacts, runTallyRows, tallyRowsOf, type RunFact } from '@beonauto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { projectionsBehaviour } from './projections-behaviour.ts';

const alpha = { org: 'acme', brain: 'alpha' };

const began: RunFact = { type: 'run_began', at: '2026-10-01T09:00:00.000Z', fn: 'triage' };

const ended: RunFact = { type: 'run_ended', status: 'failed', ms: 10, tokens: null };

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 100 };

const breakingDown = 'The projection broke down';

function noting(ledger: Awaited<ReturnType<typeof aLedger>>, stream: string, ...facts: readonly RunFact[]) {
  return Effect.runPromise(ledger.execute(stream, runFacts, facts));
}

function anAppendThatBreaksDown(entry: LedgerEntry): void {
  describe('a projection that breaks down inside an append', () => {
    it('fails the append, which keeps nothing, the row it changed before included', async () => {
      const breaking = tallyRowsOf(1, (row) => row['status'] === 'failed');
      const ledger = await aLedger(entry, undefined, undefined, [breaking]);
      await noting(ledger, 'brain/acme/alpha/executions/r1', began);

      await expect(noting(ledger, 'brain/acme/alpha/executions/r1', { type: 'run_noted' }, ended)).rejects.toThrow(
        breakingDown,
      );

      expect(
        (await Effect.runPromise(ledger.readProjectedRows('run_tallies', alpha, everyRow))).map(({ row }) => row),
      ).toMatchObject([{ status: 'started', facts: 1 }]);
      expect((await Effect.runPromise(ledger.load('brain/acme/alpha/executions/r1', runFacts))).version).toBe(1);
    });
  });
}

function aTableNotThereYet(entry: LedgerEntry): void {
  describe('the table of a projection that is not there yet', () => {
    it('is made with its indexes and filled when the ledger opens, from every run stream, and earlier versions dropped', async () => {
      const database = await entry.aDatabase();
      const first = await aLedger(entry, database, undefined, [runTallyRows]);
      await noting(first, 'brain/acme/alpha/executions/r1', began, { type: 'run_noted' });
      await noting(first, 'brain/acme/alpha/executions/r2', ended);
      await noting(first, 'brain/acme/alpha/executions/r3/nested', began);

      const next = await aLedger(entry, database, undefined, [tallyRowsOf(2)]);

      expect(await Effect.runPromise(next.readProjectedRows('run_tallies', alpha, everyRow))).toMatchObject([
        { runId: 'r1', row: { facts: 2, last_message: messageIdOf('brain/acme/alpha/executions/r1', 2) } },
      ]);
      expect(await entry.queried(database, entry.projectionTables)).toEqual([{ name: 'run_tallies_2' }]);
      expect(await entry.queried(database, entry.projectionIndexes)).toEqual([
        { name: 'run_tallies_2_by_brain_and_status' },
        { name: 'run_tallies_2_due' },
      ]);
    });

    it('is left as it is by a ledger that finds it', async () => {
      const database = await entry.aDatabase();
      await noting(await aLedger(entry, database, undefined, [runTallyRows]), 'brain/acme/alpha/executions/r1', began);
      await entry.queried(database, "DELETE FROM run_tallies_1 WHERE run_id = 'r1'");

      const reopened = await aLedger(entry, database, undefined, [runTallyRows]);

      expect(await Effect.runPromise(reopened.readProjectedRows('run_tallies', alpha, everyRow))).toEqual([]);
    });
  });
}

export function projectionTableBehaviour(entry: LedgerEntry): void {
  projectionsBehaviour((projections) => aLedger(entry, undefined, undefined, projections));
  anAppendThatBreaksDown(entry);
  aTableNotThereYet(entry);
}
