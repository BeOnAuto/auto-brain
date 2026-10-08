import { memoryLedger } from '@beonauto/operations/testing';
import { deferredCanceller } from '@beonauto/specs';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { openRequests } from '../requests/open-requests.ts';
import {
  deliveryEndedBeforeSettling,
  askedRunId,
  askedThroughPartner,
  attemptedThenStopped,
} from '../testing/index.ts';
import { cancelledRequest } from './request-cancels.ts';

const notification = {
  channel: 'partner',
  to: 'ada',
  message: 'Approve?',
  expires_at: '2026-10-09T09:00:00.000Z',
};

const question = { ...notification, answer_schema: { type: 'object' } };

const at = '2026-10-07T09:00:00.000Z';

const anyTime: unknown = expect.any(String);

const asked = { kind: 'requested', reason: 'Not needed any more' } as const;

const cancelledAsAsked = { status: 'rejected', reason: 'cancelled', kind: 'requested', detail: asked.reason };

describe('the cancel of a request', () => {
  it('settles with the answer its delivery already gave, or as delivered for a notification, and else as asked', () => {
    expect([
      cancelledRequest({ ...asked, record: question, lastDelivery: { outcome: 'answered', answer: 'yes', at } }),
      cancelledRequest({ ...asked, record: notification, lastDelivery: { outcome: 'delivered', at } }),
      cancelledRequest({ ...asked, record: question, lastDelivery: { outcome: 'delivered', at } }),
      cancelledRequest({ ...asked, record: notification, lastDelivery: { outcome: 'failed', at } }),
      cancelledRequest({ ...asked, record: question, lastDelivery: null }),
      cancelledRequest({ ...asked, record: { run: 'x' }, lastDelivery: null }),
    ]).toEqual([
      {
        status: 'succeeded',
        output: 'yes',
        record: { answered_by: 'channel:partner', answered_at: at },
        by: 'channel:partner',
      },
      { status: 'succeeded', output: {}, record: { delivered_at: at } },
      cancelledAsAsked,
      cancelledAsAsked,
      cancelledAsAsked,
      cancelledAsAsked,
    ]);
  });
});

describe('a cancel asked after a delivery answered and before its run was settled', () => {
  it('leaves the request to settle with the answer, and settles it so itself, as the channel', async () => {
    const delivered = await askedThroughPartner({ answers: true });
    delivered.receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'approve' }) });
    const address = { org: 'acme', brain: 'alpha', id: askedRunId };
    await attemptedThenStopped(delivered);

    await delivered.brain.cancel(askedRunId);
    const afterTheCancel = await delivered.brain.firstOpen();
    await Effect.runPromise(
      deferredCanceller([delivered.brain.primitive], delivered.brain.ledger.service)(
        address,
        { ...asked, by: 'acme-admin' },
        { causationId: null, correlationId: askedRunId },
      ),
    );

    expect(afterTheCancel).toMatchObject({ standing: 'answered' });
    expect(await delivered.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, record: { answered_by: 'channel:partner' } },
    });
  });
});

describe('a cancel whose delivery ends with an answer between its read of the run and its settlement', () => {
  it('reads the run again once refused, and settles with the answer, as the channel', async () => {
    const racing = deliveryEndedBeforeSettling(memoryLedger(undefined, [openRequests]), { choice: 'approve' });
    const delivering = await askedThroughPartner({ answers: true, ledger: racing.ledger });
    await racing.started();

    await delivering.brain.cancel(askedRunId);
    await racing.cancelSettled(delivering.brain.primitive);

    expect(await delivering.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, record: { answered_by: 'channel:partner' } },
    });
  });
});

describe('a cancel whose notification is delivered between its read of the run and its settlement', () => {
  it('reads the run again, as it changed, and succeeds it as delivered', async () => {
    const racing = deliveryEndedBeforeSettling(memoryLedger(undefined, [openRequests]));
    const delivering = await askedThroughPartner({ notification: true, ledger: racing.ledger });
    await racing.started();

    await delivering.brain.cancel(askedRunId);
    await racing.cancelSettled(delivering.brain.primitive);

    expect(await delivering.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: {}, record: { delivered_at: anyTime } },
    });
  });
});
