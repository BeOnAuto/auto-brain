import { createBrain } from '@beonauto/brains';
import { workflowFacts } from '@beonauto/coordination';
import { nudging } from '@beonauto/interaction/testing';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { BrainRegistry, allPermissions, makeDispatcher, type CallerIdentity } from '@beonauto/operations';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';

import { logsToStderr } from '../logging/logging.ts';
import { factsComposedOf } from './composed-facts.ts';
import { applicationLayer } from './composition-root.ts';

const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' };

const statusOfAlpha = Effect.gen(function* () {
  const registry = yield* BrainRegistry;
  return yield* registry.status({ org: 'acme', brain: 'alpha' });
});

describe('the services the brain operations run on', () => {
  it('are the only services at the top level of the runtime, beside Effect’s own', async () => {
    const runtime = ManagedRuntime.make(
      applicationLayer(ledgerLayer({ fileName: ':memory:' })).pipe(Layer.provideMerge(logsToStderr('json'))),
    );

    const keys = [...(await runtime.context()).mapUnsafe.keys()];
    await runtime.dispose();

    expect(keys.filter((key) => !key.startsWith('effect/')).toSorted()).toEqual([
      '@beonauto/operations/BrainRegistry',
      '@beonauto/operations/IncidentReporter',
      '@beonauto/operations/Ledger',
    ]);
  });

  it('share one ledger, so the brain registry finds a brain the operations created', async () => {
    const runtime = ManagedRuntime.make(applicationLayer(ledgerLayer({ fileName: ':memory:' })));
    const created = makeDispatcher([]).dispatchToOrg(createBrain.registration, {
      caller: acmeAdmin,
      org: 'acme',
      input: { brain: 'alpha', name: 'Alpha' },
      encoding: 'json',
    });

    const outcome = await runtime.runPromise(created);
    const status = await runtime.runPromise(statusOfAlpha);
    await runtime.dispose();

    expect({ outcome: outcome.status, status }).toEqual({ outcome: 'succeeded', status: 'active' });
  });
});

const runsNothing = {
  run: () => Promise.reject(new Error('The facts are composed before anything runs')),
  dispose: () => Promise.resolve(),
};

describe('the facts the server composes from its capabilities and the workflow’s, as it starts', () => {
  it('are refused, and the server does not start, when a fact or a stream kind is declared twice or a fact the brain records itself, naming it and the capability', () => {
    const prodding = { ...nudging, type: 'prodding' };
    const claiming = {
      ...nudging,
      type: 'claiming',
      facts: { ...nudging.facts, onRuns: nudging.facts.onRuns.map((fact) => ({ ...fact, type: 'run_failed' })) },
    };
    const logging = { ...nudging, type: 'logging', facts: { onRuns: [], streams: workflowFacts.facts.streams } };

    expect(() => factsComposedOf(runsNothing, [nudging, prodding])).toThrow(
      'The fact nudge_sent is declared by the capabilities nudging and prodding, and one capability alone may declare it',
    );
    expect(() => factsComposedOf(runsNothing, [claiming])).toThrow(
      'The fact run_failed that the capability claiming declares is one the brain records itself',
    );
    expect(() => factsComposedOf(runsNothing, [logging])).toThrow(
      'The stream kind run-logs is declared by the capabilities logging and workflow, and one capability alone may declare it',
    );
    expect(factsComposedOf(runsNothing, [nudging]).facts).toEqual({
      onRuns: nudging.facts.onRuns,
      streams: workflowFacts.facts.streams,
    });
  });
});
