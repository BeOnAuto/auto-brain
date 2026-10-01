import { Conflict, type Ledger } from '@beonauto/operations';
import { memoryLedger } from '@beonauto/operations/testing';
import { Effect, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { journal, type JournalEvent } from './testing/journal.ts';
import { openLedger, type OpenLedger } from './testing/open-ledger.ts';
import { tally, type Amounts } from './testing/tally.ts';

const opened: OpenLedger[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map(({ dispose }) => dispose()));
});

async function bothLedgers(): Promise<readonly [onSqlite: Ledger['Service'], inMemory: Ledger['Service']]> {
  const open = await openLedger();
  opened.push(open);
  return [open.ledger, memoryLedger().service];
}

const commands: readonly Amounts[] = [[1, 2], [], [-10], [4], [-7], []];

function tallyThrough(ledger: Ledger['Service']): Promise<unknown> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const executed = yield* Effect.forEach(commands, (amounts) =>
        Effect.result(ledger.execute('org/acme/tallies', tally, amounts)),
      );
      const loaded = yield* ledger.load('org/acme/tallies', tally);
      return { executed, loaded };
    }),
  );
}

const entries: readonly (readonly JournalEvent[])[] = [
  [{ type: 'entry_written', at: new Date(86_400_000), amount: 7n, ratio: 0.5, tags: ['a'], source: null }],
  [],
  [
    { type: 'entry_struck', reason: 'Wrong amount' },
    {
      type: 'entry_written',
      at: new Date(0),
      amount: -7n,
      ratio: Number.POSITIVE_INFINITY,
      tags: [],
      memo: 'Corrected',
      source: { name: 'Review' },
    },
  ],
];

function journalThrough(ledger: Ledger['Service']): Promise<unknown> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const executed = yield* Effect.forEach(entries, (events) =>
        ledger.execute('brain/acme/sales/journal', journal, events),
      );
      const loaded = yield* ledger.load('brain/acme/sales/journal', journal);
      return { executed, loaded };
    }),
  );
}

async function loadAskedForBeforeAWrite(ledger: Ledger['Service']): Promise<unknown> {
  const loading = ledger.load('org/acme/tallies', tally);
  await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [2]));
  return Effect.runPromise(loading);
}

describe('the ledger and the in-memory ledger of the application layer', () => {
  it('give the same states, versions and refusals for the same decider and commands', async () => {
    const [onSqlite, inMemory] = await bothLedgers();

    const expected = {
      executed: [
        Result.succeed({ state: 3, version: 2 }),
        Result.succeed({ state: 3, version: 2 }),
        Result.fail(new Conflict({ detail: 'A tally of 3 cannot fall to -7' })),
        Result.succeed({ state: 7, version: 3 }),
        Result.succeed({ state: 0, version: 4 }),
        Result.succeed({ state: 0, version: 4 }),
      ],
      loaded: { state: 0, version: 4 },
    };
    expect(await tallyThrough(onSqlite)).toEqual(expected);
    expect(await tallyThrough(inMemory)).toEqual(expected);
  });

  it('give back the same events for a schema whose JSON encoding differs from its type', async () => {
    const [onSqlite, inMemory] = await bothLedgers();

    const throughSqlite = await journalThrough(onSqlite);

    expect(throughSqlite).toEqual(await journalThrough(inMemory));
    expect(throughSqlite).toMatchObject({ loaded: { state: entries.flat(), version: 3 } });
  });

  it('read a stream when the load runs, not when it is asked for', async () => {
    const [onSqlite, inMemory] = await bothLedgers();

    expect(await loadAskedForBeforeAWrite(onSqlite)).toEqual({ state: 2, version: 1 });
    expect(await loadAskedForBeforeAWrite(inMemory)).toEqual({ state: 2, version: 1 });
  });
});
