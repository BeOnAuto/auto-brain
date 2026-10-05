import { once } from 'node:events';
import { createServer } from 'node:net';

import { Ledger } from '@beonauto/operations';
import { Cause, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { postgresqlLedgerLayer } from './postgresql-ledger.ts';

async function aPortNobodyListensOn(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  await once(server, 'close');
  return typeof address === 'object' && address !== null ? address.port : 0;
}

describe('a ledger on PostgreSQL that cannot be reached', () => {
  it('fails to build, with a defect naming the address it tried and no credential', async () => {
    const port = await aPortNobodyListensOn();
    const layer = postgresqlLedgerLayer({
      connectionString: `postgresql://brains:a-secret-password@127.0.0.1:${port}/brains`,
    });

    const cause = await Effect.runPromise(Effect.provide(Ledger, layer).pipe(Effect.sandbox, Effect.flip));

    expect({ dies: Cause.hasDies(cause), fails: Cause.hasFails(cause) }).toEqual({ dies: true, fails: false });
    expect(Cause.pretty(cause)).toContain(`ECONNREFUSED 127.0.0.1:${port}`);
    expect(Cause.pretty(cause)).not.toContain('a-secret-password');
  });
});
