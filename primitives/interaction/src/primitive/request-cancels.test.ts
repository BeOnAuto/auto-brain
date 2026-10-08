import { memoryLedger } from '@beonauto/operations/testing';
import { deferredCanceller, replyRecorder } from '@beonauto/specs';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { openRequests } from '../requests/open-requests.ts';
import { askedRunId, askedThroughChat, broughtBeforeSettling, takenReply } from '../testing/index.ts';
import { cancelledRequest } from './request-cancels.ts';

const notification = {
  to: 'ada',
  message: 'Approve?',
  expires_at: '2026-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
};

const question = { ...notification, answer_schema: { type: 'object' } };

const at = '2026-10-07T09:00:00.000Z';

const anyTime: unknown = expect.any(String);

const address = { org: 'acme', brain: 'alpha', id: askedRunId };

const asked = { execution: address, kind: 'requested', reason: 'Not needed any more' } as const;

const cancelledAsAsked = { status: 'rejected', reason: 'cancelled', kind: 'requested', detail: asked.reason };

const brought = { answer: 'yes', at, reply: takenReply };

const answeredByTheBrain = {
  status: 'succeeded',
  output: 'yes',
  record: { answered_by: 'brain:alpha', answered_at: at, reply: takenReply },
  by: 'brain:alpha',
};

describe('the cancel of a request', () => {
  it('settles with the answer a reply already brought, or as delivered for a notification, and else as asked', () => {
    expect([
      cancelledRequest({ ...asked, record: question, broughtAnswer: brought, deliveredAt: at }),
      cancelledRequest({ ...asked, record: notification, broughtAnswer: null, deliveredAt: at }),
      cancelledRequest({ ...asked, record: question, broughtAnswer: null, deliveredAt: at }),
      cancelledRequest({ ...asked, record: notification, broughtAnswer: null, deliveredAt: null }),
      cancelledRequest({ ...asked, record: question, broughtAnswer: null, deliveredAt: null }),
      cancelledRequest({ ...asked, record: { run: 'x' }, broughtAnswer: brought, deliveredAt: at }),
    ]).toEqual([
      answeredByTheBrain,
      { status: 'succeeded', output: {}, record: { delivered_at: at } },
      cancelledAsAsked,
      cancelledAsAsked,
      cancelledAsAsked,
      cancelledAsAsked,
    ]);
  });
});

describe('a cancel asked after a reply answered and before its run was settled', () => {
  it('leaves the request to settle with the answer, and settles it so itself, as the brain', async () => {
    const { brain } = await askedThroughChat();
    const lineage = { causationId: null, correlationId: askedRunId };
    const reading = { server: 'chat', tool: 'thread_replies', reply: takenReply };
    await Effect.runPromise(
      replyRecorder(brain.ledger.service)(
        address,
        { type: 'reply_taken', ...reading, answer: { choice: 'approve' } },
        lineage,
      ),
    );

    await brain.cancel(askedRunId);
    const afterTheCancel = await brain.firstOpen();
    await Effect.runPromise(
      deferredCanceller([brain.primitive], brain.ledger.service)(address, { ...asked, by: 'acme-admin' }, lineage),
    );

    expect(afterTheCancel).toMatchObject({ standing: 'answered' });
    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: {
        status: 'succeeded',
        output: { choice: 'approve' },
        record: { answered_by: 'brain:alpha', reply: takenReply },
      },
    });
  });
});

describe('a cancel asked before a reply is read', () => {
  it('wins: the reply is not taken, and the run ends cancelled', async () => {
    const { brain } = await askedThroughChat();
    const lineage = { causationId: null, correlationId: askedRunId };
    const reading = { server: 'chat', tool: 'thread_replies', reply: takenReply };

    await brain.cancel(askedRunId);
    const taken = await Effect.runPromise(
      Effect.flip(
        replyRecorder(brain.ledger.service)(
          address,
          { type: 'reply_taken', ...reading, answer: { choice: 'approve' } },
          lineage,
        ),
      ),
    );
    await Effect.runPromise(
      deferredCanceller([brain.primitive], brain.ledger.service)(address, { ...asked, by: 'acme-admin' }, lineage),
    );

    expect(taken).toMatchObject({ detail: 'The run is being cancelled, so it takes no reply' });
    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'requested' } },
    });
  });
});

describe('a cancel whose notification is delivered between its read of the run and its settlement', () => {
  it('reads the run again, as it changed, and succeeds it as delivered', async () => {
    const racing = broughtBeforeSettling(memoryLedger(undefined, [openRequests]));
    const delivering = await askedThroughChat({ notification: true, ledger: racing.ledger });
    await racing.started();

    await delivering.brain.cancel(askedRunId);
    await racing.cancelSettled(delivering.brain.primitive);

    expect(await delivering.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: {}, record: { delivered_at: anyTime } },
    });
  });
});
