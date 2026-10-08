import { setTimeout } from 'node:timers/promises';

import { memoryLedger } from '@beonauto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { noChannels } from '../channels/channel-settings.ts';
import { defineAnswerInteraction } from '../requests/answer-interaction.ts';
import { openRequests } from '../requests/open-requests.ts';
import {
  deliveryEndedBeforeSettling,
  askedRunId,
  askedThroughPartner,
  attemptedThenStopped,
} from '../testing/index.ts';

const days = 24 * 60 * 60_000;

const answerOf = defineAnswerInteraction(noChannels);

const anyTime: unknown = expect.any(String);

describe('an answer given within the delivery, whose settlement the server stopped before', () => {
  it('is settled from the ended delivery after a restart, with no attempt made again', async () => {
    const asked = await askedThroughPartner({ answers: true, ledger: memoryLedger(undefined, [openRequests]) });
    asked.receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'approve' }) });

    const stopped = await attemptedThenStopped(asked);
    const afterStop = await asked.brain.firstOpen();
    const performed = await asked.brain.performDue(Date.now());

    expect([stopped, performed]).toEqual([true, 1]);
    expect(afterStop).toMatchObject({ attempts: 1, standing: 'answered' });
    expect(await asked.brain.runOf(askedRunId)).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', output: { choice: 'approve' }, record: { answered_by: 'channel:partner' } },
    });
    expect(asked.receiver.received()).toHaveLength(1);
  });

  it('is settled with the answer even when the restart comes after the request would have expired', async () => {
    const asked = await askedThroughPartner({ answers: true });
    asked.receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'reject' }) });

    await attemptedThenStopped(asked);
    await asked.brain.performDue(asked.askedAt + 3 * days);

    expect(await asked.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'reject' } },
    });
  });
});

describe('a notification delivered, whose settlement the server stopped before', () => {
  it('succeeds from the ended delivery after a restart, and is not delivered again', async () => {
    const asked = await askedThroughPartner({ notification: true });

    await attemptedThenStopped(asked);
    const afterStop = await asked.brain.firstOpen();
    await asked.brain.performDue(Date.now());

    expect(afterStop).toMatchObject({ attempts: 1, standing: 'delivered' });
    expect(await asked.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: {}, record: { delivered_at: anyTime } },
    });
    expect(asked.receiver.received()).toHaveLength(1);
  });
});

describe('a due request, as the host sees it', () => {
  it('calls out for an attempt, and not for an expiry, a settlement or an attempt lost', async () => {
    const { brain, askedAt } = await askedThroughPartner();

    const toAttempt = await brain.dueItems(askedAt);
    const toExpire = await brain.dueItems(askedAt + 3 * days);

    expect([toAttempt.map(({ callsOut }) => callsOut), toExpire.map(({ callsOut }) => callsOut)]).toEqual([
      [true],
      [false],
    ]);
  });
});

describe('an answer within the delivery and another one given meanwhile', () => {
  it('keeps the answer the delivery recorded first, and refuses the other as a conflict', async () => {
    const asked = await askedThroughPartner({ answers: true });
    asked.receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'approve' }) });

    await attemptedThenStopped(asked);
    const meanwhile = await asked.brain.call(answerOf, { execution_id: askedRunId, answer: { choice: 'reject' } });
    await asked.brain.performDue(Date.now());

    expect(meanwhile).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The run was answered through its channel, so that answer alone settles it',
    });
    expect(await asked.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, record: { answered_by: 'channel:partner' } },
    });
  });

  it('keeps the answer given first while the delivery is in flight, and records no end of that delivery', async () => {
    const asked = await askedThroughPartner({ answers: true });
    asked.receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'approve' }), delayMs: 300 });

    const delivering = asked.brain.performDue(asked.askedAt);
    await setTimeout(100);
    const first = await asked.brain.call(answerOf, { execution_id: askedRunId, answer: { choice: 'reject' } });
    await delivering;
    const { records } = await Effect.runPromise(
      asked.brain.ledger.service.readRecorded(
        { org: 'acme', brain: 'alpha' },
        { kind: 'run', execution: askedRunId },
        { order: 'asc', limit: 20 },
      ),
    );

    expect(first).toMatchObject({ status: 'succeeded', output: { output: { choice: 'reject' } } });
    expect(await asked.brain.runOf(askedRunId)).toMatchObject({ output: { output: { choice: 'reject' } } });
    expect(records.map(({ type }) => type)).not.toContain('delivery_ended');
  });
});

describe('an answer given while the delivery in flight ends with its own', () => {
  it('refuses the other when the delivery ends with its answer between the read of the request and the settlement', async () => {
    const racing = deliveryEndedBeforeSettling(memoryLedger(undefined, [openRequests]), { choice: 'approve' });
    const asked = await askedThroughPartner({ answers: true, ledger: racing.ledger });
    await racing.started();

    const meanwhile = await asked.brain.call(answerOf, { execution_id: askedRunId, answer: { choice: 'reject' } });
    await asked.brain.performDue(Date.now());

    expect(meanwhile).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(await asked.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, record: { answered_by: 'channel:partner' } },
    });
  });
});
