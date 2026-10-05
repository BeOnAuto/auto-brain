import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/logged-lines.ts';
import { logLedger } from './logging.ts';

describe('logLedger', () => {
  it('names the file of a ledger in SQLite', async () => {
    await expect(linesLoggedBy(logLedger({ store: 'sqlite', file: 'data/ledger.db' }))).resolves.toEqual([
      expect.stringMatching(
        /^\{"message":"The ledger is kept in the file data\/ledger.db","level":"INFO",.*"annotations":\{"ledger_file":"data\/ledger.db"\}/u,
      ),
    ]);
  });

  it('names the database and the host of a ledger in PostgreSQL, and nothing else of its URL', async () => {
    const lines = await linesLoggedBy(
      logLedger({
        store: 'postgresql',
        url: Redacted.make('postgresql://brains:a-secret-password@db.example.com:5432/brains?sslmode=require'),
        host: 'db.example.com:5432',
        database: 'brains',
      }),
    );

    expect(lines).toEqual([
      expect.stringContaining(
        '{"message":"The ledger is kept in PostgreSQL, in the database brains on db.example.com:5432","level":"INFO"',
      ),
    ]);
    expect(lines[0]).toContain('"annotations":{"database":"brains","database_host":"db.example.com:5432"}');
    expect(lines.join('\n')).not.toMatch(/a-secret-password|sslmode|postgresql:/u);
  });
});
