import { Conflict } from '@beonauto/operations';
import { Effect, Result, Struct } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { openLedger, outcomeOf, type OpenLedger } from './testing/open-ledger.ts';
import { tally, tallyInterruptedBy } from './testing/tally.ts';
import { temporaryDatabase, type TemporaryDatabase } from './testing/temporary-database.ts';

const opened: OpenLedger[] = [];
const databases: TemporaryDatabase[] = [];

async function aLedger(fileName?: string): Promise<OpenLedger['ledger']> {
  const open = await openLedger(fileName);
  opened.push(open);
  return open.ledger;
}

function aDatabaseFile(): string {
  const database = temporaryDatabase();
  databases.push(database);
  return database.fileName;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map(({ dispose }) => dispose()));
  for (const { remove } of databases.splice(0)) {
    remove();
  }
});

const tallies = 'org/acme/tallies';

const changedWhileDeciding = 'The state changed while the command was decided';

describe('writers racing on one stream', () => {
  it.each([
    ['an in-memory database', () => ':memory:'],
    ['a database file', aDatabaseFile],
  ])('neither lose an update nor share a version, on %s', async (_, fileName) => {
    const ledger = await aLedger(fileName());
    const writer = Effect.match(ledger.execute(tallies, tally, [1]), {
      onSuccess: Struct.get('version'),
      onFailure: Struct.get('detail'),
    });

    const outcomes = await Effect.runPromise(
      Effect.all(
        Array.from({ length: 6 }, () => writer),
        { concurrency: 6 },
      ),
    );

    const versions = outcomes.filter((outcome) => typeof outcome === 'number');
    const conflicts = outcomes.filter((outcome) => typeof outcome === 'string');
    expect(versions.toSorted((left, right) => left - right)).toEqual(Array.from(versions.keys(), (index) => index + 1));
    expect(conflicts).toEqual(conflicts.map(() => changedWhileDeciding));
    expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({
      state: versions.length,
      version: versions.length,
    });
  });
});

describe('a writer that another writer got ahead of', () => {
  it('decides again against the stream as it now is', async () => {
    const ledger = await aLedger();
    await Effect.runPromise(ledger.execute(tallies, tally, [1]));
    const takeOneFirst = Effect.orDie(ledger.execute(tallies, tally, [-1]));

    expect(await Effect.runPromise(ledger.execute(tallies, tallyInterruptedBy(takeOneFirst, 1), [5]))).toEqual({
      state: 5,
      version: 3,
    });
  });

  it('is rejected when the decision taken again no longer holds', async () => {
    const ledger = await aLedger();
    await Effect.runPromise(ledger.execute(tallies, tally, [1]));
    const takeOneFirst = Effect.orDie(ledger.execute(tallies, tally, [-1]));

    expect(await outcomeOf(ledger.execute(tallies, tallyInterruptedBy(takeOneFirst, 1), [-1]))).toEqual(
      Result.fail(new Conflict({ detail: 'A tally of 0 cannot fall to -1' })),
    );
    expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 0, version: 2 });
  });

  it('gives up with a conflict of a concurrent change after three retries when every append meets a version conflict', async () => {
    const ledger = await aLedger();
    const addOneFirst = Effect.orDie(ledger.execute(tallies, tally, [1]));

    expect(
      await outcomeOf(ledger.execute(tallies, tallyInterruptedBy(addOneFirst, Number.POSITIVE_INFINITY), [10])),
    ).toEqual(Result.fail(new Conflict({ detail: changedWhileDeciding, kind: 'concurrent_change' })));
    expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 4, version: 4 });
  });
});
