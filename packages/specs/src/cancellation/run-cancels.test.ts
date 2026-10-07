import { Conflict, type StreamWriter } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { executionCanceller, type CancelRequest, type ExecutionAddress } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { toBrain } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const relayed = { org: 'acme', brain: 'alpha', id: relayedId };

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: relayedId };

const deadline: CancelRequest = { kind: 'deadline', reason: 'The step that waited for it ran out of time' };

const everything = { kind: 'everything' } as const;

describe('a cancel request the workflow host records on a run', () => {
  it('is requested on a run that finishes later, by the brain itself unless an actor is named, with the lineage given', async () => {
    const { executing, ledger, run } = await withHandOn();
    await executing();
    const cancel = executionCanceller(ledger.service);

    const receipt = await Effect.runPromise(cancel(relayed, deadline, lineage));
    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded({ org: 'acme', brain: 'alpha' }, everything, { order: 'asc', limit: 20 }),
      ),
    );

    expect(receipt).toBe('requested');
    expect(records.at(-1)).toMatchObject({
      type: 'execution_cancel_requested',
      ...lineage,
      data: { kind: 'deadline', reason: deadline.reason, by: 'brain:alpha' },
    });
  });

  it('answers that the run has ended, and records the request on a run within its call, on a run not started yet, but not at an ill-formed address', async () => {
    const { call, executeSpec, executing, ledger, prober, settling } = await withHandOn();
    await executing();
    await settling({ status: 'failed' });
    const plain = '0199a3c4-7d2e-7c1a-9b3f-000000000001';
    prober.sufferOnNextRun('stall');
    void call(
      executeSpec,
      toBrain('acme', 'alpha')(acmeAdmin, { primitive: 'probe', name: 'plain', execution_id: plain }),
    );
    await prober.stalled;
    const cancel = executionCanceller(ledger.service);

    const addresses: readonly ExecutionAddress[] = [
      relayed,
      { ...relayed, id: plain },
      { ...relayed, id: '0199a3c4-7d2e-7c1a-9b3f-00000000ffff' },
      { ...relayed, id: 'not-a-run' },
      { ...relayed, brain: 'al/pha' },
    ];
    const receipts = await Effect.runPromise(
      Effect.forEach(addresses, (execution) => cancel(execution, { ...deadline, by: 'acme-admin' }, lineage)),
    );

    expect(receipts).toEqual(['ended', 'requested', 'requested', 'unknown_run', 'unknown_run']);
  });
});

describe('a cancel request the stream refuses otherwise', () => {
  it('fails with that conflict, so it is tried again', async () => {
    const changed = new Conflict({
      detail: 'The state changed while the command was decided',
      kind: 'concurrent_change',
    });
    const changing: StreamWriter = { execute: () => Effect.fail(changed) };

    expect(await Effect.runPromise(Effect.flip(executionCanceller(changing)(relayed, deadline, lineage)))).toBe(
      changed,
    );
  });
});
