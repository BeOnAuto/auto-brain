import { makeAppRuntime } from '@beonauto/api';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import type { BrainRequest, Dispatcher, Outcome } from '@beonauto/operations';
import { defineStartVersion } from '@beonauto/specs';
import { echo } from '@beonauto/specs/testing';
import { StartRefused, StartRejected } from '@beonauto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { applicationLayer } from '../composition/composition-root.ts';
import { reactionsOf } from './reaction-dependencies.ts';

const start = {
  org: 'acme',
  brain: 'alpha',
  workflow: 'close-the-month',
  version: 2,
  executionId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  input: [{ type: 'com.acme.ledger.closed' }],
  depth: 3,
  cause: 'record-1',
  trigger: { kind: 'event', reference: '/schedule/on' },
} as const;

async function reactingWith(answers: readonly Outcome[]) {
  const runtime = await makeAppRuntime(applicationLayer(ledgerLayer({ fileName: ':memory:' })));
  onTestFinished(() => runtime.dispose());
  const requests: BrainRequest[] = [];
  const dispatcher: Dispatcher = {
    dispatchToOrg: () => Effect.die(new Error('The reactions dispatch to no org')),
    dispatchToBrain: (_registration, request) =>
      Effect.sync(() => {
        requests.push(request);
        return answers[requests.length - 1] ?? { status: 'succeeded', output: {} };
      }),
  };
  return { reactions: reactionsOf(runtime, dispatcher, defineStartVersion([echo])), requests };
}

describe('a start of a workflow its trigger matched', () => {
  it('is asked of the brain as the brain itself, once under the id it was given, caused by what it matched, with its trigger', async () => {
    const { reactions, requests } = await reactingWith([]);

    await Effect.runPromise(reactions.start(start));

    expect(requests).toEqual([
      {
        caller: { id: 'brain:alpha', org: 'acme', permissions: ['brain:read', 'brain:write'], brains: ['alpha'] },
        org: 'acme',
        brain: 'alpha',
        input: {
          primitive: 'orchestration',
          name: 'close-the-month',
          version: 2,
          input: start.input,
          execution_id: start.executionId,
        },
        encoding: 'json',
        lineage: { causationId: 'record-1', correlationId: start.executionId },
        depth: 3,
        trigger: { kind: 'event', reference: '/schedule/on' },
      },
    ]);
  });

  it('is tried again when the brain cannot take it now, and not when it never will', async () => {
    const { reactions } = await reactingWith([
      { status: 'rejected', reason: 'unavailable', detail: 'The ledger is busy' },
      { status: 'failed', incident: 'i-1' },
      { status: 'rejected', reason: 'invalid_input', detail: 'The input is not what the workflow takes' },
    ]);

    const failures = await Effect.runPromise(Effect.forEach([1, 2, 3], () => Effect.flip(reactions.start(start))));

    expect(failures).toStrictEqual([
      new StartRefused({ detail: 'The ledger is busy' }),
      new StartRefused({ detail: 'The start failed with incident i-1' }),
      new StartRejected({ detail: 'The input is not what the workflow takes' }),
    ]);
  });
});

describe('an event a workflow emits', () => {
  it('is recorded in the ledger of the server', async () => {
    const { reactions } = await reactingWith([]);
    const emission = {
      event: {
        specversion: '1.0',
        id: 'e1',
        source: '/ledger',
        type: 'com.acme.ledger.closed',
        time: '2026-10-01T09:00:00.000Z',
      },
      emitter: { execution_id: start.executionId, workflow: 'announce', version: 1 },
      depth: 1,
      by: 'brain:alpha',
      at: '2026-10-01T09:00:00.000Z',
    };

    const outcome = await Effect.runPromise(
      reactions.emit({ org: 'acme', brain: 'alpha' }, emission, {
        causationId: null,
        correlationId: start.executionId,
      }),
    );

    expect(outcome).toBe('recorded');
  });
});
