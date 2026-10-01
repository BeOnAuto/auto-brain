import { fstatSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Ledger } from '@beonauto/operations';
import { Cause, Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { ledgerLayer } from './index.ts';
import { journal } from './testing/journal.ts';
import { openLedger, outcomeOf } from './testing/open-ledger.ts';
import { tally, tallyInterruptedBy } from './testing/tally.ts';
import { temporaryDatabase, type TemporaryDatabase } from './testing/temporary-database.ts';

const databases: TemporaryDatabase[] = [];

function aDatabaseFile(): string {
  const database = temporaryDatabase();
  databases.push(database);
  return database.fileName;
}

afterEach(() => {
  for (const { remove } of databases.splice(0)) {
    remove();
  }
});

const tallies = 'org/acme/tallies';

function opensTheFile(descriptor: number, device: number, inode: number): boolean {
  try {
    const opened = fstatSync(descriptor);
    return opened.dev === device && opened.ino === inode;
  } catch {
    return false;
  }
}

function failureToBuild(fileName: string): Promise<Cause.Cause<never>> {
  return Effect.runPromise(Effect.provide(Ledger, ledgerLayer({ fileName })).pipe(Effect.sandbox, Effect.flip));
}

function descriptorsOpenOn(fileName: string): number {
  const { dev, ino } = statSync(fileName);
  return readdirSync('/dev/fd').filter((descriptor) => opensTheFile(Number(descriptor), dev, ino)).length;
}

describe('a ledger on a database file', () => {
  it('keeps what was written when the file is closed and opened again', async () => {
    const fileName = aDatabaseFile();
    const first = await openLedger(fileName);
    await Effect.runPromise(first.ledger.execute(tallies, tally, [2, 3]));
    await Effect.runPromise(
      first.ledger.execute('brain/acme/sales/journal', journal, [{ type: 'entry_struck', reason: 'Duplicate' }]),
    );
    await first.dispose();

    const second = await openLedger(fileName);
    const reloaded = await Effect.runPromise(
      Effect.all([second.ledger.load(tallies, tally), second.ledger.load('brain/acme/sales/journal', journal)]),
    );
    const continued = await Effect.runPromise(second.ledger.execute(tallies, tally, [4]));
    await second.dispose();

    expect(reloaded).toEqual([
      { state: 5, version: 2 },
      { state: [{ type: 'entry_struck', reason: 'Duplicate' }], version: 1 },
    ]);
    expect(continued).toEqual({ state: 9, version: 3 });
  });

  it('closes every connection to the file when the runtime is disposed', async () => {
    const fileName = aDatabaseFile();
    const { ledger, dispose } = await openLedger(fileName);
    await Effect.runPromise(Effect.all([ledger.execute(tallies, tally, [1]), ledger.load('org/acme/other', tally)]));
    const whileOpen = descriptorsOpenOn(fileName);

    await dispose();

    expect({ openBeforeDisposal: whileOpen > 0, openAfterDisposal: descriptorsOpenOn(fileName) }).toEqual({
      openBeforeDisposal: true,
      openAfterDisposal: 0,
    });
  });
});

describe('a ledger whose database is gone', () => {
  it('answers every call after disposal with a defect', async () => {
    const { ledger, dispose } = await openLedger();
    await dispose();

    await expect(outcomeOf(ledger.load(tallies, tally))).rejects.toThrow('Singleton connection pool has been closed');
    await expect(outcomeOf(ledger.execute(tallies, tally, [1]))).rejects.toThrow(
      'Singleton connection pool has been closed',
    );
  });

  it('turns a write that fails for a reason other than a moved stream into a defect', async () => {
    const { ledger, dispose } = await openLedger();
    const closeTheDatabaseFirst = Effect.promise(dispose);

    await expect(outcomeOf(ledger.execute(tallies, tallyInterruptedBy(closeTheDatabaseFirst, 1), [1]))).rejects.toThrow(
      'TaskProcessor has been stopped',
    );
  });

  it('fails to build, with a defect, when its database cannot be opened', async () => {
    const fileName = dirname(aDatabaseFile());

    const cause = await failureToBuild(fileName);

    expect({ dies: Cause.hasDies(cause), fails: Cause.hasFails(cause) }).toEqual({ dies: true, fails: false });
    expect(Cause.pretty(cause)).toContain('SQLITE_CANTOPEN: unable to open database file');
  });

  it('fails to build, with a defect, when the directory of its database cannot be created', async () => {
    const aFile = join(dirname(aDatabaseFile()), 'a-file');
    writeFileSync(aFile, '');

    const cause = await failureToBuild(join(aFile, 'ledger.db'));

    expect({ dies: Cause.hasDies(cause), fails: Cause.hasFails(cause) }).toEqual({ dies: true, fails: false });
    expect(Cause.pretty(cause)).toContain('EEXIST: file already exists, mkdir');
  });
});

describe('a ledger on a database file in a directory that does not exist yet', () => {
  it('creates the directory and keeps what was written', async () => {
    const fileName = join(dirname(aDatabaseFile()), 'missing', 'deeper', 'ledger.db');
    const first = await openLedger(fileName);
    await Effect.runPromise(first.ledger.execute(tallies, tally, [2, 3]));
    await first.dispose();

    const second = await openLedger(fileName);
    const reloaded = await Effect.runPromise(second.ledger.load(tallies, tally));
    await second.dispose();

    expect({ created: statSync(fileName).isFile(), reloaded }).toEqual({
      created: true,
      reloaded: { state: 5, version: 2 },
    });
  });
});
