import { memoryLedger } from '@beonauto/operations/testing';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { openRequests } from '../requests/open-requests.ts';
import {
  askedRunId,
  askedThroughChat,
  attemptedThenStopped,
  broughtBeforeSettling,
  recordedReply,
  takenReply,
} from '../testing/index.ts';

const days = 24 * 60 * 60_000;

const anyTime: unknown = expect.any(String);

const answeredByTheReply = { answered_by: 'brain:alpha', reply: takenReply };

describe('an answer a reply brought, whose settlement the server stopped before', () => {
  it('is settled from the reply after a restart, as the brain, with no attempt made again', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    await brain.performDue(askedAt);
    await recordedReply(brain.ledger, { choice: 'approve' });

    const afterStop = await brain.firstOpen();
    const performed = await brain.performDue(Date.now());

    expect([afterStop, performed]).toMatchObject([{ attempts: 1, standing: 'answered' }, 1]);
    expect(await brain.runOf(askedRunId)).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', output: { choice: 'approve' }, record: answeredByTheReply },
    });
    expect(tools.calls()).toHaveLength(1);
  });

  it('is settled with the answer even when the restart comes after the request would have expired', async () => {
    const { brain, askedAt } = await askedThroughChat();
    await recordedReply(brain.ledger, { choice: 'reject' });

    await brain.performDue(askedAt + 3 * days);

    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'reject' } },
    });
  });
});

describe('a notification delivered, whose settlement the server stopped before', () => {
  it('succeeds from the ended delivery after a restart, and is not delivered again', async () => {
    const asked = await askedThroughChat({ notification: true });

    const stopped = await attemptedThenStopped(asked);
    const afterStop = await asked.brain.firstOpen();
    await asked.brain.performDue(Date.now());

    expect([stopped, afterStop]).toMatchObject([true, { attempts: 1, standing: 'delivered' }]);
    expect(await asked.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: {}, record: { delivered_at: anyTime } },
    });
    expect(asked.tools.calls()).toHaveLength(1);
  });
});

describe('a due request, as the host sees it', () => {
  it('calls out for an attempt, and not for an expiry, a settlement or an attempt lost', async () => {
    const { brain, askedAt } = await askedThroughChat();

    const toAttempt = await brain.dueItems(askedAt);
    const toExpire = await brain.dueItems(askedAt + 3 * days);

    expect([toAttempt.map(({ callsOut }) => callsOut), toExpire.map(({ callsOut }) => callsOut)]).toEqual([
      [true],
      [false],
    ]);
  });
});

describe('an answer a reply brought and another one given meanwhile', () => {
  it('keeps the answer of the reply, and refuses the other as a conflict', async () => {
    const { brain } = await askedThroughChat();
    await recordedReply(brain.ledger, { choice: 'approve' });

    const meanwhile = await brain.call(answerInteraction, { run_id: askedRunId, answer: { choice: 'reject' } });
    await brain.performDue(Date.now());

    expect(meanwhile).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The run was answered by a reply, so that answer alone settles it',
    });
    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, record: answeredByTheReply },
    });
  });

  it('refuses the other when a reply is taken between the read of the request and the settlement', async () => {
    const racing = broughtBeforeSettling(memoryLedger(undefined, [openRequests]), { choice: 'approve' });
    const asked = await askedThroughChat({ ledger: racing.ledger });
    await racing.started();

    const meanwhile = await asked.brain.call(answerInteraction, {
      run_id: askedRunId,
      answer: { choice: 'reject' },
    });
    await asked.brain.performDue(Date.now());

    expect(meanwhile).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(await asked.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, record: answeredByTheReply },
    });
  });
});
