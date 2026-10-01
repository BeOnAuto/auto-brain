import { BrainRegistry, defineQuery, makeDispatcher, type CallerIdentity } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { createBrain, ledgerBrainRegistry, retireBrain } from '../index.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

function existence(org: string, brain: string) {
  return BrainRegistry.use((registry) => registry.exists({ org, brain }));
}

const Empty = Schema.Record(Schema.String, Schema.Never);

const ping = defineQuery('brain', {
  name: 'ping',
  title: 'Ping',
  description: 'Answers from within a brain.',
  route: { method: 'GET', path: '/ping' },
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () => Effect.succeed({}),
});

function pinging(caller: CallerIdentity, org: string, brain: string) {
  return makeDispatcher([]).dispatchToBrain(ping.registration, { caller, org, brain, input: {}, encoding: 'json' });
}

describe('the brain registry on the ledger', () => {
  it('finds a brain from its creation until its retirement', async () => {
    const { call, run } = harness(ledgerBrainRegistry);

    expect(await run(existence('acme', 'alpha'))).toBe(false);
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));
    expect(await run(existence('acme', 'alpha'))).toBe(true);
    await call(retireBrain, toAcme(acmeAdmin, { brain: 'alpha' }));
    expect(await run(existence('acme', 'alpha'))).toBe(false);
  });

  it('reads the very stream the brain operations write', async () => {
    const { call, ledger, run } = harness(ledgerBrainRegistry);
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));

    expect(ledger.streamNames()).toEqual(['org/acme/brains']);
    expect(await run(existence('acme', 'alpha'))).toBe(true);
  });

  it('keeps the brains of each org apart', async () => {
    const { call, run } = harness(ledgerBrainRegistry);
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));

    expect(await run(existence('acme', 'alpha'))).toBe(true);
    expect(await run(existence('globex', 'alpha'))).toBe(false);
    expect(await run(existence('acme', 'beta'))).toBe(false);
  });

  it('lets an operation within a brain access an active brain and not a retired one', async () => {
    const { call, run } = harness(ledgerBrainRegistry);
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));
    await call(createBrain, toOrg('globex')(globexAdmin, { brain: 'gamma', name: 'Gamma' }));
    await call(retireBrain, toOrg('globex')(globexAdmin, { brain: 'gamma' }));

    expect(await run(pinging(acmeAdmin, 'acme', 'alpha'))).toEqual({ status: 'succeeded', output: {} });
    expect(await run(pinging(globexAdmin, 'globex', 'gamma'))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no brain gamma in this org',
    });
  });
});
