import { createBrain } from '@beonauto/brains';
import { BrainDirectory, everyPermission, makeDispatcher, type CallerIdentity } from '@beonauto/operations';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';

import { applicationLayer } from './composition-root.ts';
import { jsonLogsToStderr } from './logging.ts';

const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: everyPermission, brains: '*' };

const alphaExists = Effect.gen(function* () {
  const directory = yield* BrainDirectory;
  return yield* directory.exists({ org: 'acme', brain: 'alpha' });
});

describe('the services the brain operations run on', () => {
  it('are the only services at the top level of the runtime, beside Effect’s own', async () => {
    const runtime = ManagedRuntime.make(applicationLayer(':memory:').pipe(Layer.provideMerge(jsonLogsToStderr)));

    const keys = [...(await runtime.context()).mapUnsafe.keys()];
    await runtime.dispose();

    expect(keys.filter((key) => !key.startsWith('effect/')).toSorted()).toEqual([
      '@beonauto/operations/BrainDirectory',
      '@beonauto/operations/IncidentReporter',
      '@beonauto/operations/Ledger',
    ]);
  });

  it('share one ledger, so the brain directory finds a brain the operations created', async () => {
    const runtime = ManagedRuntime.make(applicationLayer(':memory:'));
    const created = makeDispatcher([]).inOrg(createBrain.registration, {
      caller: acmeAdmin,
      org: 'acme',
      input: { brain: 'alpha', name: 'Alpha' },
      form: 'json',
    });

    const outcome = await runtime.runPromise(created);
    const exists = await runtime.runPromise(alphaExists);
    await runtime.dispose();

    expect({ status: outcome.status, exists }).toEqual({ status: 'done', exists: true });
  });
});
