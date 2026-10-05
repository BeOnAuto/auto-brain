import { BrainRegistry, defineCommand, defineQuery, makeDispatcher, type CallerIdentity } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { createBrain, ledgerBrainRegistry, retireBrain } from '../index.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

function statusOf(org: string, brain: string) {
  return BrainRegistry.use((registry) => registry.status({ org, brain }));
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

const poke = defineCommand('brain', {
  name: 'poke',
  title: 'Poke',
  description: 'Changes nothing within a brain.',
  route: { method: 'POST', path: '/poke' },
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () => Effect.succeed({}),
});

function calling(operation: typeof ping | typeof poke, caller: CallerIdentity, org: string, brain: string) {
  return makeDispatcher([]).dispatchToBrain(operation.registration, {
    caller,
    org,
    brain,
    input: {},
    encoding: 'json',
  });
}

describe('the brain registry on the ledger', () => {
  it('knows a brain as active from its creation, and as retired from its retirement', async () => {
    const { call, run } = harness(ledgerBrainRegistry);

    expect(await run(statusOf('acme', 'alpha'))).toBe('unknown');
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));
    expect(await run(statusOf('acme', 'alpha'))).toBe('active');
    await call(retireBrain, toAcme(acmeAdmin, { brain: 'alpha' }));
    expect(await run(statusOf('acme', 'alpha'))).toBe('retired');
  });

  it('reads the very stream the brain operations write', async () => {
    const { call, ledger, run } = harness(ledgerBrainRegistry);
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));

    expect(ledger.streamNames()).toEqual(['org/acme/brains']);
    expect(await run(statusOf('acme', 'alpha'))).toBe('active');
  });

  it('keeps the brains of each org apart', async () => {
    const { call, run } = harness(ledgerBrainRegistry);
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));

    expect(await run(statusOf('acme', 'alpha'))).toBe('active');
    expect(await run(statusOf('globex', 'alpha'))).toBe('unknown');
    expect(await run(statusOf('acme', 'beta'))).toBe('unknown');
  });
});

describe('a retired brain, to an operation within it', () => {
  it('answers a query, so what it recorded stays readable', async () => {
    const { call, run } = harness(ledgerBrainRegistry);
    await call(createBrain, toOrg('globex')(globexAdmin, { brain: 'gamma', name: 'Gamma' }));
    await call(retireBrain, toOrg('globex')(globexAdmin, { brain: 'gamma' }));

    expect(await run(calling(ping, globexAdmin, 'globex', 'gamma'))).toEqual({ status: 'succeeded', output: {} });
  });

  it('refuses a command with the conflict update_brain gives for a retired brain', async () => {
    const { call, run } = harness(ledgerBrainRegistry);
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));
    await call(createBrain, toOrg('globex')(globexAdmin, { brain: 'gamma', name: 'Gamma' }));
    await call(retireBrain, toOrg('globex')(globexAdmin, { brain: 'gamma' }));

    expect(await run(calling(poke, acmeAdmin, 'acme', 'alpha'))).toEqual({ status: 'succeeded', output: {} });
    expect(await run(calling(poke, globexAdmin, 'globex', 'gamma'))).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The brain gamma is retired and can no longer change',
      kind: 'retired',
    });
  });
});
