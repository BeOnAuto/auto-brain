import type { RecordedSelection } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  details,
  happen,
  happenings,
  inAlpha,
  noted,
  reading,
  streamsAndTypes,
  type AnyLedger,
  type LedgerMaker,
} from './happenings.ts';

const runs: RecordedSelection = { kind: 'executions' };

function theRunsAPageExamines(aLedger: LedgerMaker): void {
  describe('the runs a page of runs examines', () => {
    it(
      'are at most 1,000, so a page that finds none of the status asked for still carries a cursor',
      { timeout: 60_000 },
      async () => {
        const ledger = await aLedger();
        await happen(ledger, inAlpha('executions/oldest'), noted('execution_started'), noted('execution_failed'));
        await Effect.runPromise(
          Effect.forEach(
            Array.from({ length: 1000 }, (_, index) => index),
            (index) => ledger.execute(inAlpha(`executions/run-${index}`), happenings, [noted('execution_started')]),
            { concurrency: 8, discard: true },
          ),
        );

        const page = { order: 'desc', limit: 20, types: ['execution_failed'] } as const;
        const first = await reading(ledger, runs, page);
        const rest = await reading(ledger, runs, { ...page, cursor: String(first.nextCursor) });

        expect([first.records.length, first.hasMore, streamsAndTypes(rest), rest.nextCursor]).toEqual([
          0,
          true,
          [
            'brain/acme/alpha/executions/oldest execution_started',
            'brain/acme/alpha/executions/oldest execution_failed',
          ],
          null,
        ]);
      },
    );
  });
}

function theStreamsOfOneRun(aLedger: LedgerMaker): void {
  describe('the read of one run', () => {
    it('gives the messages of its execution stream and its run log, in order, and nothing else', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('executions/r1'), noted('execution_started'));
      await happen(ledger, inAlpha('runs/r1'), noted('input_applied'));
      await happen(ledger, inAlpha('executions/r10'), noted('execution_started'));
      await happen(ledger, inAlpha('runs/r1x'), noted('input_applied'));
      await happen(ledger, 'brain/acme/beta/executions/r1', noted('execution_started'));
      await happen(ledger, inAlpha('executions/r1'), noted('execution_succeeded'));

      const page = await reading(ledger, { kind: 'run', execution: 'r1' }, { order: 'asc', limit: 10 });

      expect(streamsAndTypes(page)).toEqual([
        'brain/acme/alpha/executions/r1 execution_started',
        'brain/acme/alpha/runs/r1 input_applied',
        'brain/acme/alpha/executions/r1 execution_succeeded',
      ]);
    });
  });
}

async function threeRuns(ledger: AnyLedger): Promise<void> {
  await happen(ledger, inAlpha('executions/r1'), noted('execution_started', 'r1'));
  await happen(ledger, inAlpha('runs/r1'), noted('input_applied'));
  await happen(ledger, inAlpha('executions/r2'), noted('execution_started', 'r2'));
  await happen(ledger, inAlpha('executions/r3'), noted('execution_started', 'r3'));
  await happen(ledger, inAlpha('notes'), noted('noted'));
  await happen(ledger, inAlpha('executions/r1'), noted('execution_succeeded', 'r1 done'));
  await happen(ledger, inAlpha('executions/r3'), noted('execution_failed', 'r3 done'));
  await happen(ledger, 'brain/acme/alpha2/executions/r4', noted('execution_started', 'r4'));
}

function theRunsOfABrain(aLedger: LedgerMaker): void {
  describe('the read of the runs of a brain', () => {
    it('gives the first and the latest message of every run, by the position of its first, either way', async () => {
      const ledger = await aLedger();
      await threeRuns(ledger);

      const pages = await Promise.all([
        reading(ledger, runs, { order: 'desc', limit: 10 }),
        reading(ledger, runs, { order: 'asc', limit: 2 }),
      ]);

      expect(pages.map((page) => [details(page), page.hasMore])).toEqual([
        [['r3', 'r3 done', 'r2', 'r1', 'r1 done'], false],
        [['r1', 'r1 done', 'r2'], true],
      ]);
    });

    it('keeps to the runs whose latest message is of the types asked for', async () => {
      const ledger = await aLedger();
      await threeRuns(ledger);

      const pages = await Promise.all(
        ([['execution_failed'], ['execution_started'], ['execution_succeeded', 'execution_failed']] as const).map(
          (types) => reading(ledger, runs, { order: 'desc', limit: 10, types }),
        ),
      );

      expect(pages.map((page) => details(page))).toEqual([
        ['r3', 'r3 done'],
        ['r2'],
        ['r3', 'r3 done', 'r1', 'r1 done'],
      ]);
    });
  });
}

const withNul = { text: 'a NUL \u0000 inside', also: 'half a pair \uD800 alone' };

function aRunHoldingU0000(aLedger: LedgerMaker): void {
  describe('a run whose input and output hold U+0000', () => {
    it('is listed, filtered and read, its data exactly as it was decided', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('executions/r1'), noted('execution_started', { input: withNul }));
      await happen(ledger, inAlpha('executions/r1'), noted('execution_succeeded', { output: withNul }));

      const pages = await Promise.all([
        reading(ledger, runs, { order: 'desc', limit: 10 }),
        reading(ledger, runs, { order: 'desc', limit: 10, types: ['execution_succeeded'] }),
        reading(ledger, { kind: 'run', execution: 'r1' }, { order: 'asc', limit: 10 }),
      ]);

      const decided = [{ input: withNul }, { output: withNul }];
      expect(pages.map((page) => details(page))).toEqual([decided, decided, decided]);
    });
  });
}

export function runsBehaviour(aLedger: LedgerMaker): void {
  theRunsAPageExamines(aLedger);
  theStreamsOfOneRun(aLedger);
  theRunsOfABrain(aLedger);
  aRunHoldingU0000(aLedger);
}
