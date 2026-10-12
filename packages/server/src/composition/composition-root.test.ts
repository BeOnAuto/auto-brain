import { createPlaybook } from '@beonauto/brains';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { PlaybookRegistry, allPermissions, makeDispatcher, type CallerIdentity } from '@beonauto/operations';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';

import { logsToStderr } from '../logging/logging.ts';
import { applicationLayer } from './composition-root.ts';

const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' };

const statusOfAlpha = Effect.gen(function* () {
  const registry = yield* PlaybookRegistry;
  return yield* registry.status({ org: 'acme', playbook: 'alpha' });
});

describe('the services the playbook operations run on', () => {
  it('are the only services at the top level of the runtime, beside Effect’s own', async () => {
    const runtime = ManagedRuntime.make(
      applicationLayer(ledgerLayer({ fileName: ':memory:' })).pipe(Layer.provideMerge(logsToStderr('json'))),
    );

    const keys = [...(await runtime.context()).mapUnsafe.keys()];
    await runtime.dispose();

    expect(keys.filter((key) => !key.startsWith('effect/')).toSorted()).toEqual([
      '@beonauto/operations/IncidentReporter',
      '@beonauto/operations/Ledger',
      '@beonauto/operations/PlaybookRegistry',
    ]);
  });

  it('share one ledger, so the playbook registry finds a playbook the operations created', async () => {
    const runtime = ManagedRuntime.make(applicationLayer(ledgerLayer({ fileName: ':memory:' })));
    const created = makeDispatcher([]).dispatchToOrg(createPlaybook.registration, {
      caller: acmeAdmin,
      org: 'acme',
      input: { playbook: 'alpha', name: 'Alpha' },
      encoding: 'json',
    });

    const outcome = await runtime.runPromise(created);
    const status = await runtime.runPromise(statusOfAlpha);
    await runtime.dispose();

    expect({ outcome: outcome.status, status }).toEqual({ outcome: 'succeeded', status: 'active' });
  });
});
