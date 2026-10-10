import type { Context, ProjectedRow } from '@beonauto/operations';
import { Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { openRequests } from './open-requests.ts';

const messageId = '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a';

const at = '2026-10-07T09:00:00.000Z';

const ofTheRun: Context = {
  by: 'brain:alpha',
  at,
  definitionType: 'interaction',
  definitionName: 'approve-brief',
  definitionVersion: 1,
};

interface Fact {
  readonly type: string;
  readonly data: unknown;
}

function after(row: ProjectedRow | undefined, { type, data }: Fact, context: Context = ofTheRun) {
  return openRequests.rowAfter(row, { id: messageId, position: 2, type, data, context });
}

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
  requested_at: at,
  deliver,
};

function deferralOf(record: object): Fact {
  return { type: 'run_deferred', data: { record } };
}

const open = after(undefined, deferralOf(request));

const failedRun: Fact = { type: 'run_failed', data: {} };

describe('the open request of a run', () => {
  it('is made by the deferral of an interaction function alone', () => {
    expect([
      open,
      after(undefined, deferralOf(request), { ...ofTheRun, definitionType: 'workflow' }),
      after(undefined, deferralOf({ run: 'x' })),
    ]).toEqual([
      {
        request_id: messageId,
        function: 'approve-brief',
        version: 1,
        party: 'ada',
        delivery: JSON.stringify({ server: 'chat', tool: 'post_message' }),
        replies: null,
        message: 'Approve?',
        answers: true,
        answer_schema: '{}',
        requested_at: Date.parse(at),
        expires_at: Date.parse(request.expires_at),
        attempts: 0,
        next_attempt_at: Date.parse(at),
        standing: 'to_deliver',
        open: true,
        attempt_due_at: Date.parse(at),
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

  it('names a function and version the context left out as none and the first', () => {
    expect(
      after(undefined, deferralOf(request), { by: 'brain:alpha', at, definitionType: 'interaction' }),
    ).toMatchObject({ function: '', version: 1 });
  });
});

describe('the open request of a run, as its request recorded it', () => {
  it('keeps the tool it delivers through and how it reads replies as JSON text, and neither in the inbox', () => {
    const inbox = Struct.omit(request, ['deliver']);

    expect([after(undefined, deferralOf({ ...request, replies })), after(undefined, deferralOf(inbox))]).toMatchObject([
      { delivery: JSON.stringify({ server: 'chat', tool: 'post_message' }), replies: JSON.stringify(replies) },
      { delivery: null, replies: null, standing: 'in_inbox', attempt_due_at: null },
    ]);
  });

  it('keeps the answer schema its request recorded as JSON text, and none for a notification', () => {
    const answerSchema = { type: 'object', required: ['choice'], properties: { choice: { type: 'string' } } };
    const notification = Struct.omit(request, ['answer_schema']);

    expect([
      after(undefined, deferralOf({ ...request, answer_schema: answerSchema })),
      after(undefined, deferralOf(notification)),
    ]).toMatchObject([
      { answers: true, answer_schema: JSON.stringify(answerSchema) },
      { answers: false, answer_schema: null },
    ]);
  });
});

describe('the open request of a run that ends', () => {
  it('closes with the ending of its run, in the words of that ending, and changes no more after', () => {
    const cancelled = after(open, {
      type: 'run_rejected',
      data: { rejection: { reason: 'cancelled', kind: 'requested', detail: 'Off' } },
    });

    expect([cancelled, after(open, failedRun), after(cancelled, failedRun)]).toMatchObject([
      { open: false, attempt_due_at: null, ending_due_at: null, ended: 'cancelled' },
      { open: false, ended: 'failed' },
      undefined,
    ]);
  });

  it('is unchanged by a fact it does not keep, by what does not read as a fact, and by facts of a run without one', () => {
    const toolCall = {
      type: 'tool_call_started',
      data: {
        number: 1,
        call_id: 'c1',
        server: 'graph',
        tool: 'search',
        arguments_bytes: 2,
        arguments_sha256: 'a'.repeat(64),
        content_kept: true,
      },
    };

    expect([after(open, toolCall), after(open, { type: 'nonsense', data: {} }), after(undefined, failedRun)]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

const cancelAsked: Fact = { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Off' } };

const attempt: Fact = {
  type: 'delivery_started',
  data: { number: 1, target: 'ada', server: 'chat', tool: 'post_message' },
};

const answerOfTheTool = { result_bytes: 2, result_sha256: 'b'.repeat(64), content_kept: true, jsonrpc_id: 1 };

const delivered: Fact = { type: 'delivery_succeeded', data: { number: 1, ...answerOfTheTool, duration_ms: 40 } };

const taken: Fact = {
  type: 'reply_taken',
  data: {
    server: 'chat',
    tool: 'thread_replies',
    reply: { id: '1699.2', sender: 'ada' },
    answer: { choice: 'approve' },
  },
};

describe('the open request of a run asked to cancel', () => {
  it('stands cancelling and falls due no more, whatever its attempt in flight does', () => {
    const delivering = after(open, attempt);
    const cancelling = after(delivering, cancelAsked);
    const afterTheAttempt = after(cancelling, delivered);
    const failedAfter = after(cancelling, {
      type: 'delivery_failed',
      data: { number: 1, because: 'server_failure', duration_ms: 40 },
    });
    const takenAfter = after(cancelling, taken);

    expect([cancelling, afterTheAttempt, failedAfter, takenAfter]).toMatchObject([
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null, open: true },
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null, attempts: 1 },
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null },
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null },
    ]);
    expect(after(after(cancelling, attempt), cancelAsked)).toMatchObject({ standing: 'cancelling' });
  });
});

describe('the open request of a run a reply answered', () => {
  it('stands answered once a reply answered it, due at once, and a cancel asked after leaves it so', () => {
    const answered = after(open, taken);

    expect([answered, after(answered, cancelAsked)]).toMatchObject([
      { standing: 'answered', ending_due_at: Date.parse(at), attempt_due_at: null },
      undefined,
    ]);
  });

  it('is left alone once its run has ended', () => {
    expect(after(after(open, failedRun), cancelAsked)).toBeUndefined();
  });
});
