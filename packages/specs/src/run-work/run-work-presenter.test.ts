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
      data: { to: record['to'] ?? null },
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
    expect(
      presented({
        type: 'execution_deferred',
        record: {
          to: 'ada',
          message: 'Approve?',
          expires_at: '2026-10-09T09:00:00.000Z',
          requested_at: '2026-10-07T09:00:00.000Z',
        },
        ...ofAsking,
        ...fact,
      }),
    ).toEqual([
      {
        type: 'interaction_requested',
        summary: 'A request is waiting for an answer.',
        data: { execution_id: executionId, by: 'brain:alpha', record_bytes: 115, to: 'ada' },
      },
    ]);
  });
});

const delivery = { delivery: { server: 'chat', tool: 'post_message' } };

const started: ExecutionEvent = {
  type: 'delivery_started',
  number: 1,
  target: 'ada',
  server: 'chat',
  tool: 'post_message',
  arguments_bytes: 3000,
  arguments_sha256: 'a'.repeat(200),
  arguments_json: 'x'.repeat(3000),
  ...ofAsking,
  ...fact,
};

const ended: ExecutionEvent = {
  type: 'delivery_ended',
  number: 1,
  outcome: 'failed',
  because: 'server_failure',
  retry_after_ms: 120_000,
  detail: 'x'.repeat(2000),
  result_bytes: null,
  result_sha256: null,
  jsonrpc_id: `rpc-${'7'.repeat(200)}`,
  server_request_id: null,
  duration_ms: 40,
  ...ofAsking,
  ...fact,
};

describe('the start of a delivery', () => {
  it('is its attempt, the tool it calls, its target and its arguments as recorded, the content cut', () => {
    expect(presented(started)).toEqual([
      {
        type: 'delivery_started',
        summary: 'Delivery attempt 1 of the request started, through the tool post_message of chat.',
        data: {
          execution_id: executionId,
          by: 'brain:alpha',
          number: 1,
          ...delivery,
          target: 'ada',
          arguments_bytes: 3000,
          arguments_sha256: 'a'.repeat(128),
          arguments_json: 'x'.repeat(2048),
        },
      },
    ]);
  });

  it('is its attempt, the tool and its target alone for an attempt that made no call', () => {
    const bare: ExecutionEvent = {
      type: 'delivery_started',
      number: 2,
      target: 'ada',
      server: 'chat',
      tool: 'post_message',
      ...ofAsking,
      ...fact,
    };

    expect(presented(bare)).toMatchObject([
      { data: { execution_id: executionId, by: 'brain:alpha', number: 2, ...delivery, target: 'ada' } },
    ]);
  });
});

describe('the end of a delivery', () => {
  it('is how the attempt ended, in words, with every fact of it and its detail cut', () => {
    expect(presented(ended)).toEqual([
      {
        type: 'delivery_ended',
        summary:
          'Delivery attempt 1 failed, because the tool server failed; another follows on the schedule, unless it was the last.',
        data: {
          execution_id: executionId,
          by: 'brain:alpha',
          number: 1,
          outcome: 'failed',
          because: 'server_failure',
          retry_after_ms: 120_000,
          detail: 'x'.repeat(1024),
          result_bytes: null,
          result_sha256: null,
          jsonrpc_id: `rpc-${'7'.repeat(124)}`,
          server_request_id: null,
          duration_ms: 40,
        },
      },
    ]);
  });
});

describe('the end of a delivery that answered', () => {
  it('shows what the tool answered, at 2 KiB, and what the message was delivered as and where replies are read', () => {
    const delivered: ExecutionEvent = {
      type: 'delivery_ended',
      number: 1,
      outcome: 'delivered',
      result_bytes: 3000,
      result_sha256: 'b'.repeat(64),
      result_json: 'y'.repeat(3000),
      jsonrpc_id: 3,
      server_request_id: 'call-1',
      duration_ms: 5,
      delivered_as: { conversation: 'C0123', id: '1699.1' },
      replies_in: { server: 'chat', tool: 'thread_replies', key: `C0123/${'k'.repeat(300)}` },
      ...ofAsking,
      ...fact,
    };

    expect(presented(delivered)).toMatchObject([
      {
        data: {
          result_bytes: 3000,
          result_sha256: 'b'.repeat(64),
          result_json: 'y'.repeat(2048),
          jsonrpc_id: 3,
          server_request_id: 'call-1',
          delivered_as: { conversation: 'C0123', id: '1699.1' },
          replies_in: { server: 'chat', tool: 'thread_replies', key: `C0123/${'k'.repeat(250)}` },
        },
      },
    ]);
  });
});

describe('the end of a delivery of a capability the server no longer has', () => {
  it('is in the words every capability gives', () => {
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

const ofTheReply = { server: 'chat', tool: 'thread_replies', reply: { id: '1699.2', sender: 'ada' } };

const shownReply = { reading: { server: 'chat', tool: 'thread_replies' }, reply: { id: '1699.2', sender: 'ada' } };

describe('a reply the run took or refused', () => {
  it('is told in words with the identity of the reply and never its words, the answer by its size alone', () => {
    expect(
      presented({ type: 'reply_taken', ...ofTheReply, answer: { choice: 'approve' }, ...ofAsking, ...fact }),
    ).toEqual([
      {
        type: 'reply_taken',
        summary: 'A reply from the party answered the request, read through the tool thread_replies of chat.',
        data: { execution_id: executionId, by: 'brain:alpha', ...shownReply, answer_bytes: 20 },
      },
    ]);
  });
});

describe('a reply the run refused', () => {
  it('says whether the party was told how to answer, with the issues of an answer that did not fit', () => {
    const refused = { type: 'reply_refused', ...ofTheReply, ...ofAsking, ...fact } as const;

    expect([
      ...presented({ ...refused, because: 'not_an_answer', told: true }),
      ...presented({
        ...refused,
        because: 'invalid',
        issues: [{ pointer: '/answer/note', detail: 'Too long' }],
        told: false,
      }),
    ]).toEqual([
      {
        type: 'reply_refused',
        summary: 'A reply from the party was not an answer the function takes, and the party was told how to answer.',
        data: { execution_id: executionId, by: 'brain:alpha', ...shownReply, because: 'not_an_answer', told: true },
      },
      {
        type: 'reply_refused',
        summary: 'A reply from the party was not an answer the function takes, and nobody was told.',
        data: {
          execution_id: executionId,
          by: 'brain:alpha',
          ...shownReply,
          because: 'invalid',
          told: false,
          issue_count: 1,
          issues: [{ pointer: '/answer/note', detail: 'Too long' }],
        },
      },
    ]);
  });
});
