import { mkdirSync } from 'node:fs';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { openSQLiteDatabase } from './sqlite-database.ts';
import { statement } from './statement.ts';

const tablesOfTheHost = statement`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'workflow_%' ORDER BY name`;

describe('the host database on SQLite', () => {
  it('keeps the tables of the host beside the ledger, in the same file', async () => {
    const file = aSQLiteFile();
    const first = await openedOn({ store: 'sqlite', file });
    const second = await openedOn({ store: 'sqlite', file });

    const tables = await Effect.runPromise(second.read(tablesOfTheHost));
    const ledger = await Effect.runPromise(
      first.read(statement`SELECT COUNT(*) AS streams FROM sqlite_master WHERE name = 'emt_streams'`),
    );

    expect(tables).toEqual(
      [
        'workflow_calls',
        'workflow_due',
        'workflow_runs',
        'workflow_settlements',
        'workflow_snapshot_chunks',
        'workflow_timers',
      ].map((name) => ({ name })),
    );
    expect(ledger).toEqual([{ streams: 1 }]);
  });

  it('opens a private database in memory', async () => {
    const database = await openedOn({ store: 'sqlite', file: ':memory:' });

    expect(await Effect.runPromise(database.read(tablesOfTheHost))).toHaveLength(6);
  });

  it('fails a statement the database refuses with the error of the driver', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });

    const failure = await Effect.runPromise(Effect.flip(database.write(statement`INSERT INTO nowhere VALUES (${1})`)));

    expect(failure.detail).toContain('no such table: nowhere');
  });

  it('does not open a file that is a directory', async () => {
    const file = aSQLiteFile();
    mkdirSync(file);

    await expect(openSQLiteDatabase(file)).rejects.toThrow('SQLITE_CANTOPEN');
  });
});
