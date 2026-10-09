import { Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { openRequests } from './open-requests.ts';

const message = { id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', position: 2 };

const fact = { by: 'brain:alpha', at: '2026-10-07T09:00:00.000Z', name: 'approve-brief', definition_version: 1 };

const deliver = { server: 'chat', tool: 'post_message', with: { text: '{{ message }}' } };

const replies = {
  tool: 'thread_replies',
  with: { ts: '{{ sent.id }}' },
  read: { list: '/messages', order: 'oldest_first', each: { id: '/ts', sender: '/user', text: '/text' } },
};

const request = {
  to: 'ada',
  message: 'Approve?',
  answer_schema: {},
  expires_at: '2026-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
  deliver,
};

const deferral = { type: 'run_deferred', record: request, definition_type: 'interaction', ...fact };

const open = openRequests.rowAfter(undefined, deferral, message);

describe('the open request of a run', () => {
  it('is made by the deferral of an interaction function alone', () => {
    expect([
      open,
      openRequests.rowAfter(undefined, { ...deferral, definition_type: 'workflow' }, message),
      openRequests.rowAfter(undefined, { ...deferral, record: { run: 'x' } }, message),
    ]).toEqual([
      {
        request_id: message.id,
        function: 'approve-brief',
        version: 1,
        party: 'ada',
        delivery: JSON.stringify({ server: 'chat', tool: 'post_message' }),
        replies: null,
        message: 'Approve?',
        answers: true,
        answer_schema: '{}',
        requested_at: Date.parse(fact.at),
        expires_at: Date.parse(request.expires_at),
        attempts: 0,
        next_attempt_at: Date.parse(fact.at),
        standing: 'to_deliver',
        open: true,
        attempt_due_at: Date.parse(fact.at),
        ending_due_at: Date.parse(request.expires_at),
        ended: null,
        conversation: null,
        sent_conversation: null,
        sent_id: null,
        answerer: null,
        reply: null,
        reply_refusals: 0,
        refusals_told: 0,
      },
      undefined,
      undefined,
    ]);
  });
});

describe('the open request of a run, as its request recorded it', () => {
  it('keeps the tool it delivers through and how it reads replies as JSON text, and neither in the inbox', () => {
    const inbox = Struct.omit(request, ['deliver']);

    expect([
      openRequests.rowAfter(undefined, { ...deferral, record: { ...request, replies } }, message),
      openRequests.rowAfter(undefined, { ...deferral, record: inbox }, message),
    ]).toMatchObject([
      { delivery: JSON.stringify({ server: 'chat', tool: 'post_message' }), replies: JSON.stringify(replies) },
      { delivery: null, replies: null, standing: 'in_inbox', attempt_due_at: null },
    ]);
  });

  it('keeps the answer schema its request recorded as JSON text, and none for a notification', () => {
    const answerSchema = { type: 'object', required: ['choice'], properties: { choice: { type: 'string' } } };
    const notification = Struct.omit(request, ['answer_schema']);

    expect([
      openRequests.rowAfter(undefined, { ...deferral, record: { ...request, answer_schema: answerSchema } }, message),
      openRequests.rowAfter(undefined, { ...deferral, record: notification }, message),
    ]).toMatchObject([
      { answers: true, answer_schema: JSON.stringify(answerSchema) },
      { answers: false, answer_schema: null },
    ]);
  });
});

describe('the open request of a run that ends', () => {
  it('closes with the ending of its run, in the words of that ending, and changes no more after', () => {
    const ending = (rejection: object) => ({
      type: 'run_rejected',
      rejection,
      definition_type: 'interaction',
      ...fact,
    });
    const cancelled = openRequests.rowAfter(
      open,
      ending({ reason: 'cancelled', kind: 'requested', detail: 'Off' }),
      message,
    );

    expect([
      cancelled,
      openRequests.rowAfter(open, { type: 'run_failed', definition_type: 'interaction', ...fact }, message),
      openRequests.rowAfter(cancelled, { type: 'run_failed', definition_type: 'interaction', ...fact }, message),
    ]).toMatchObject([
      { open: false, attempt_due_at: null, ending_due_at: null, ended: 'cancelled' },
      { open: false, ended: 'failed' },
      undefined,
    ]);
  });

  it('is unchanged by a fact it does not keep, by what does not read as a fact, and by facts of a run without one', () => {
    const toolCall = {
      type: 'tool_call_started',
      number: 1,
      call_id: 'c1',
      server: 'graph',
      tool: 'search',
      arguments_bytes: 2,
      arguments_sha256: 'a'.repeat(64),
      ...fact,
    };

    expect([
      openRequests.rowAfter(open, toolCall, message),
      openRequests.rowAfter(open, { type: 'nonsense' }, message),
      openRequests.rowAfter(undefined, { type: 'run_failed', definition_type: 'interaction', ...fact }, message),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

const cancelAsked = { type: 'run_cancel_requested', kind: 'requested', reason: 'Off', ...fact };
const ofTheRun = { definition_type: 'interaction', ...fact };
const attempt = {
  type: 'delivery_started',
  number: 1,
  target: 'ada',
  server: 'chat',
  tool: 'post_message',
  ...ofTheRun,
};
const delivered = { type: 'delivery_ended', number: 1, outcome: 'delivered', duration_ms: 40, ...ofTheRun };
const taken = {
  type: 'reply_taken',
  server: 'chat',
  tool: 'thread_replies',
  reply: { id: '1699.2', sender: 'ada' },
  answer: { choice: 'approve' },
  ...ofTheRun,
};

describe('the open request of a run asked to cancel', () => {
  it('stands cancelling and falls due no more, whatever its attempt in flight does', () => {
    const delivering = openRequests.rowAfter(open, attempt, message);
    const cancelling = openRequests.rowAfter(delivering, cancelAsked, message);
    const afterTheAttempt = openRequests.rowAfter(cancelling, delivered, message);
    const failedAfter = openRequests.rowAfter(
      cancelling,
      { type: 'delivery_ended', number: 1, outcome: 'failed', because: 'server_failure', duration_ms: 40, ...ofTheRun },
      message,
    );
    const takenAfter = openRequests.rowAfter(cancelling, taken, message);

    expect([cancelling, afterTheAttempt, failedAfter, takenAfter]).toMatchObject([
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null, open: true },
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null, attempts: 1 },
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null },
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null },
    ]);
    expect(
      openRequests.rowAfter(openRequests.rowAfter(cancelling, attempt, message), cancelAsked, message),
    ).toMatchObject({ standing: 'cancelling' });
  });
});

describe('the open request of a run a reply answered', () => {
  it('stands answered once a reply answered it, due at once, and a cancel asked after leaves it so', () => {
    const answered = openRequests.rowAfter(open, taken, message);

    expect([answered, openRequests.rowAfter(answered, cancelAsked, message)]).toMatchObject([
      { standing: 'answered', ending_due_at: Date.parse(fact.at), attempt_due_at: null },
      undefined,
    ]);
  });

  it('is left alone once its run has ended', () => {
    const closed = openRequests.rowAfter(
      open,
      { type: 'run_failed', definition_type: 'interaction', ...fact },
      message,
    );

    expect(openRequests.rowAfter(closed, cancelAsked, message)).toBeUndefined();
  });
});
