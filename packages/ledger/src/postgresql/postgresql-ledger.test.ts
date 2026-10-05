import { Ledger } from '@beonauto/operations';
import { Cause, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { unreachableDatabase } from '../testing/index.ts';
import { postgresqlLedgerLayer } from './postgresql-ledger.ts';

describe('a ledger on PostgreSQL that cannot be reached', () => {
  it('fails to build, with a defect naming the address it tried and no credential', async () => {
    const { url, port, password } = await unreachableDatabase();

    const cause = await Effect.runPromise(
      Effect.provide(Ledger, postgresqlLedgerLayer({ connectionString: url })).pipe(Effect.sandbox, Effect.flip),
    );

    expect({ dies: Cause.hasDies(cause), fails: Cause.hasFails(cause) }).toEqual({ dies: true, fails: false });
    expect(Cause.pretty(cause)).toContain(`ECONNREFUSED 127.0.0.1:${port}`);
    expect(Cause.pretty(cause)).not.toContain(password);
  });
});
