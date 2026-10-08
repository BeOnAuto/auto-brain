import { describe, expect, it } from 'vitest';

import { openRequests } from './open-requests.ts';

const message = { id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', position: 2 };

const fact = { by: 'brain:alpha', at: '2026-10-07T09:00:00.000Z', name: 'approve-brief', spec_version: 1 };

const request = {
  channel: 'partner',
  to: 'ada',
  message: 'Approve?',
  answer_schema: {},
  expires_at: '2026-10-09T09:00:00.000Z',
};

const deferral = { type: 'execution_deferred', record: request, primitive: 'interaction', ...fact };

const open = openRequests.rowAfter(undefined, deferral, message);

describe('the open request of a run', () => {
  it('is made by the deferral of an interaction function alone', () => {
    expect([
      open,
      openRequests.rowAfter(undefined, { ...deferral, primitive: 'orchestration' }, message),
      openRequests.rowAfter(undefined, { ...deferral, record: { run: 'x' } }, message),
    ]).toEqual([
      {
        request_id: message.id,
        function: 'approve-brief',
        version: 1,
        party: 'ada',
        channel: 'partner',
        message: 'Approve?',
        answers: true,
        requested_at: Date.parse(fact.at),
        expires_at: Date.parse(request.expires_at),
        attempts: 0,
        next_attempt_at: Date.parse(fact.at),
        standing: 'to_deliver',
        open: true,
        attempt_due_at: Date.parse(fact.at),
        ending_due_at: Date.parse(request.expires_at),
        ended: null,
      },
      undefined,
      undefined,
    ]);
  });
});

describe('the open request of a run that ends', () => {
  it('closes with the ending of its run, in the words of that ending, and changes no more after', () => {
    const ending = (rejection: object) => ({
      type: 'execution_rejected',
      rejection,
      primitive: 'interaction',
      ...fact,
    });
    const cancelled = openRequests.rowAfter(
      open,
      ending({ reason: 'cancelled', kind: 'requested', detail: 'Off' }),
      message,
    );

    expect([
      cancelled,
      openRequests.rowAfter(open, { type: 'execution_failed', primitive: 'interaction', ...fact }, message),
      openRequests.rowAfter(cancelled, { type: 'execution_failed', primitive: 'interaction', ...fact }, message),
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
      openRequests.rowAfter(undefined, { type: 'execution_failed', primitive: 'interaction', ...fact }, message),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe('the open request of a run asked to cancel', () => {
  const cancelAsked = { type: 'execution_cancel_requested', kind: 'requested', reason: 'Off', ...fact };
  const ofTheRun = { primitive: 'interaction', ...fact };
  const attempt = { type: 'delivery_started', number: 1, channel: 'partner', target: 'ada', ...ofTheRun };
  const answered = {
    type: 'delivery_ended',
    number: 1,
    outcome: 'answered',
    status: 200,
    answer: { choice: 'approve' },
    duration_ms: 40,
    ...ofTheRun,
  };

  it('stands cancelling and falls due no more, whatever its attempt in flight does', () => {
    const delivering = openRequests.rowAfter(open, attempt, message);
    const cancelling = openRequests.rowAfter(delivering, cancelAsked, message);
    const afterTheAttempt = openRequests.rowAfter(cancelling, answered, message);
    const failedAfter = openRequests.rowAfter(
      cancelling,
      { type: 'delivery_ended', number: 1, outcome: 'failed', status: 503, duration_ms: 40, ...ofTheRun },
      message,
    );

    expect([cancelling, afterTheAttempt, failedAfter]).toMatchObject([
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null, open: true },
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null, attempts: 1 },
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null },
    ]);
    expect(
      openRequests.rowAfter(openRequests.rowAfter(cancelling, attempt, message), cancelAsked, message),
    ).toMatchObject({ standing: 'cancelling' });
  });

  it('is left alone once its run has ended', () => {
    const closed = openRequests.rowAfter(
      open,
      { type: 'execution_failed', primitive: 'interaction', ...fact },
      message,
    );

    expect(openRequests.rowAfter(closed, cancelAsked, message)).toBeUndefined();
  });
});
