import { describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { ledgerDatabaseOf } from './ledger-database.ts';

const somePools: unknown = expect.any(Function);

describe('the database of the ledger and the workflow host', () => {
  it('is the file of the ledger when the ledger is kept in SQLite', () => {
    expect(ledgerDatabaseOf(readSettings({ LEDGER_FILE: '/data/ledger.db' }))).toEqual({
      store: 'sqlite',
      file: '/data/ledger.db',
    });
  });

  it('is reached through the pools the server composes when the ledger is kept in PostgreSQL', () => {
    expect(
      ledgerDatabaseOf(readSettings({ DATABASE_URL: 'postgresql://playbooks:secret@db.example.com/playbooks' })),
    ).toEqual({ store: 'postgresql', pools: somePools });
  });
});
