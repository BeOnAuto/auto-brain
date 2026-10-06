import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { openedOn } from '../testing/host-files.ts';
import { statement, textOnPostgreSQL } from './statement.ts';

const runId = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

describe('a statement of the host', () => {
  it('numbers its values on PostgreSQL, in the order they appear', () => {
    const due = statement`UPDATE workflow_timers SET due_at = ${2000} WHERE run_id = ${runId} AND timer_id = ${'1'}`;

    expect([textOnPostgreSQL(due), due.values]).toEqual([
      'UPDATE workflow_timers SET due_at = $1 WHERE run_id = $2 AND timer_id = $3',
      [2000, runId, '1'],
    ]);
  });

  it('binds the same values on SQLite', async () => {
    const database = await openedOn({ store: 'sqlite', file: ':memory:' });

    const rows = await Effect.runPromise(database.read(statement`SELECT ${7} AS seven, ${null} AS empty`));

    expect(rows).toEqual([{ seven: 7, empty: null }]);
  });
});
