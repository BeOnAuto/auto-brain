import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { executionCanceller, type CancelRequest } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { toBrain } from '../testing/harness.ts';
import { withHandOn } from '../testing/relaying.ts';

const toAlpha = toBrain('acme', 'alpha');

const childId = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const child = { org: 'acme', brain: 'alpha', id: childId };

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: childId };

const parentEnded: CancelRequest = { kind: 'parent_ended', reason: 'The run that waited for it ended first' };

describe('a cancel by the caller of a run that has not started', () => {
  it('is the first record of its stream, so the start that lands after it is rejected as cancelled and runs nothing', async () => {
    const { call, executeSpec, getExecution, cancelExecution, ledger, relayer } = await withHandOn();
    const cancel = executionCanceller(ledger.service);

    const receipt = await Effect.runPromise(cancel(child, parentEnded, lineage));
    const started = await call(
      executeSpec,
      toAlpha(acmeAdmin, { primitive: 'relay', name: 'hand-on', input: {}, execution_id: childId }),
    );
    const read = await call(getExecution, toAlpha(acmeAdmin, { execution_id: childId }));
    const again = await Effect.runPromise(cancel(child, parentEnded, lineage));

    expect(receipt).toBe('requested');
    expect(started).toMatchObject({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'parent_ended',
      detail: parentEnded.reason,
    });
    expect([relayer.runs(), read]).toMatchObject([0, { status: 'rejected', reason: 'not_found' }]);
    expect(again).toBe('requested');
    expect(await call(cancelExecution, toAlpha(acmeAdmin, { execution_id: childId }))).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
    });
  });
});

describe('a run within its call that its caller cancels and then interrupts', () => {
  it('ends rejected as cancelled with the kind of the cancel, not failed', async () => {
    const { call, callCancelledWhen, executeSpec, getExecution, ledger, prober } = await withHandOn();
    const cancel = executionCanceller(ledger.service);
    prober.sufferOnNextRun('stall');
    const cancelled = prober.stalled.then(() => Effect.runPromise(cancel(child, parentEnded, lineage)));

    const settled = await callCancelledWhen(
      cancelled,
      executeSpec,
      toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', input: {}, execution_id: childId }),
    );
    const read = await call(getExecution, toAlpha(acmeAdmin, { execution_id: childId }));

    expect(settled).toEqual({ status: 'cancelled' });
    expect(read).toMatchObject({
      output: {
        status: 'rejected',
        rejection: { reason: 'cancelled', kind: 'parent_ended', detail: parentEnded.reason },
      },
    });
  });

  it('ends failed when nothing asked for its cancel before it was interrupted', async () => {
    const { call, callCancelledWhen, executeSpec, getExecution, prober } = await withHandOn();
    prober.sufferOnNextRun('stall');

    await callCancelledWhen(
      prober.stalled,
      executeSpec,
      toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', input: {}, execution_id: childId }),
    );

    expect(await call(getExecution, toAlpha(acmeAdmin, { execution_id: childId }))).toMatchObject({
      output: { status: 'failed' },
    });
  });
});
