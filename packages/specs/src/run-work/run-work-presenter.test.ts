import { presentationOf, type RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ExecutionEventSchema, type ExecutionEvent } from '../execution/execution-events.ts';
import { makeSpecPresenters } from '../presenting/spec-presenters.ts';
import { defaultRunWords, type Primitive } from '../primitive/primitive.ts';
import { echo } from '../testing/echo.ts';

const asking: Primitive = {
  ...echo,
  name: 'asking',
  runWords: {
    ...defaultRunWords,
    deferralType: 'interaction_requested',
    deferral: (record) => ({
      summary: 'A request is waiting for an answer.',
      data: { channel: record['channel'] ?? null },
    }),
  },
};

const { present, storedTypesOf } = presentationOf(makeSpecPresenters([echo, asking]));

const encode = Schema.encodeSync(Schema.toCodecJson(ExecutionEventSchema));

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const fact = { by: 'brain:alpha', at: '2026-10-01T09:00:01.000Z' };

const ofAsking = { primitive: 'asking', name: 'approve', spec_version: 1 };

function presented(event: ExecutionEvent) {
  const record: RecordedEvent = {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: 'request-1',
    correlationId: executionId,
    stream: `executions/${executionId}`,
    version: 2,
    type: event.type,
    data: encode(event),
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
  return present(record).map(({ type, summary, data }) => ({ type, summary, data }));
}

describe('the deferral of a run whose capability gives words of it', () => {
  it('is named by the public type the capability gives it, beside the one every other capability shows', () => {
    expect([storedTypesOf('interaction_requested'), storedTypesOf('execution_deferred')]).toEqual([
      ['execution_deferred'],
      ['execution_deferred'],
    ]);
  });

  it('is the request, in the words of the capability, with the size of its record', () => {
    expect(presented({ type: 'execution_deferred', record: { channel: 'inbox' }, ...ofAsking, ...fact })).toEqual([
      {
        type: 'interaction_requested',
        summary: 'A request is waiting for an answer.',
        data: { execution_id: executionId, by: 'brain:alpha', record_bytes: 19, channel: 'inbox' },
      },
    ]);
  });
});

const started: ExecutionEvent = {
  type: 'delivery_started',
  number: 1,
  channel: 'partner',
  target: 'https://partner.example.com/requests',
  ...ofAsking,
  ...fact,
};

const ended: ExecutionEvent = {
  type: 'delivery_ended',
  number: 1,
  outcome: 'failed',
  status: 429,
  because: 'status',
  retry_after_ms: 120_000,
  response_bytes: 12,
  detail: 'x'.repeat(2000),
  duration_ms: 40,
  ...ofAsking,
  ...fact,
};

describe('the start of a delivery', () => {
  it('is its attempt, its channel and its target, in words', () => {
    expect(presented(started)).toEqual([
      {
        type: 'delivery_started',
        summary: 'Delivery attempt 1 of the request started, through the channel “partner”.',
        data: {
          execution_id: executionId,
          by: 'brain:alpha',
          number: 1,
          channel: 'partner',
          target: 'https://partner.example.com/requests',
        },
      },
    ]);
  });
});

describe('the end of a delivery', () => {
  it('is how the attempt ended, in words, with every fact of it and its detail cut', () => {
    expect(presented(ended)).toEqual([
      {
        type: 'delivery_ended',
        summary:
          'Delivery attempt 1 failed, because the receiver answered “too many requests”; another follows on the schedule, unless it was the last.',
        data: {
          execution_id: executionId,
          by: 'brain:alpha',
          number: 1,
          outcome: 'failed',
          status: 429,
          because: 'status',
          retry_after_ms: 120_000,
          response_bytes: 12,
          detail: 'x'.repeat(1024),
          duration_ms: 40,
        },
      },
    ]);
  });

  it('is in the words every capability gives, for a run of a capability the server no longer has', () => {
    const delivered: ExecutionEvent = {
      type: 'delivery_ended',
      number: 2,
      outcome: 'delivered',
      duration_ms: 5,
      primitive: 'gone',
      name: 'approve',
      spec_version: 1,
      ...fact,
    };

    expect(presented(delivered)).toEqual([
      {
        type: 'delivery_ended',
        summary: 'Delivery attempt 2 was delivered.',
        data: { execution_id: executionId, by: 'brain:alpha', number: 2, outcome: 'delivered', duration_ms: 5 },
      },
    ]);
  });
});
