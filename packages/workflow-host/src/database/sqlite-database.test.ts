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
        'workflow_followed_brains',
        'workflow_followed_orgs',
        'workflow_followed_scans',
        'workflow_leases',
        'workflow_listener_types',
        'workflow_listeners',
        'workflow_passed_runs',
        'workflow_reaction_backlog',
        'workflow_reaction_rates',
        'workflow_reaction_refusals',
        'workflow_runs',
        'workflow_settlements',
        'workflow_snapshot_chunks',
        'workflow_subscriptions',
        'workflow_timers',
      ].map((name) => ({ name })),
    );
    expect(ledger).toEqual([{ streams: 1 }]);
  });
});

describe('the host database on SQLite, made before a column was added', () => {
  it('adds the column of the record that armed a timer to a timers table made before it, once', async () => {
    const file = aSQLiteFile();
    const first = await openedOn({ store: 'sqlite', file });
    await Effect.runPromise(first.write(statement`ALTER TABLE workflow_timers DROP COLUMN armed_by`));
    await openedOn({ store: 'sqlite', file });
    const third = await openedOn({ store: 'sqlite', file });

    expect(
      await Effect.runPromise(
        third.read(statement`SELECT name FROM pragma_table_info('workflow_timers') WHERE name = 'armed_by'`),
      ),
    ).toEqual([{ name: 'armed_by' }]);
  });
});

describe('the host database on SQLite, in memory or refusing', () => {
  it('opens a private database in memory', async () => {
    const database = await openedOn({ store: 'sqlite', file: ':memory:' });

    expect(await Effect.runPromise(database.read(tablesOfTheHost))).toHaveLength(17);
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
