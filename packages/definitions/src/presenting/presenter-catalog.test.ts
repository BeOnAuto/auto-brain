import {
  PublicEventSchema,
  mostPublicEventDataBytes,
  presentationOf,
  streamKindOf,
  type Context,
  type RecordedEvent,
} from '@beonauto/operations';
import { Result, Schema, SchemaAST } from 'effect';
import { describe, expect, it } from 'vitest';

import { publishedEventDecider, publishedEventStreamOf, type EventPublished } from '../events/published-events.ts';
import { makeDefinitionPresenters } from '../index.ts';
import { definitionsDecider, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { mostInputBytes, mostResultBytes } from '../runs/recorded-size.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { echo } from '../testing/echo.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const longestType = 'p'.repeat(32);

const runStream = runStreamNameOf(runId);

const definitionStream = definitionTypeStreamOf(longestType);

const definitionsOfTheLongestType = definitionsDecider(longestType);

const eventStream = publishedEventStreamOf('/ledger/eu', 'm-1');

type DefinitionEvent = typeof definitionsOfTheLongestType.eventSchema.Type;

function storedTypesOf(ast: SchemaAST.AST): readonly string[] {
  const members = SchemaAST.isUnion(ast) ? ast.types : [ast];
  return members.flatMap((member) =>
    SchemaAST.isObjects(member)
      ? member.propertySignatures.flatMap(({ name, type }) =>
          name === 'type' && SchemaAST.isLiteral(type) ? [String(type.literal)] : [],
        )
      : [],
  );
}

const catalog = [
  { stream: runStream, storedTypes: storedTypesOf(runDecider.eventSchema.ast) },
  { stream: definitionStream, storedTypes: storedTypesOf(definitionsOfTheLongestType.eventSchema.ast) },
  { stream: eventStream, storedTypes: storedTypesOf(publishedEventDecider.eventSchema.ast) },
] as const;

const presenters = makeDefinitionPresenters([echo]);

const { present } = presentationOf(presenters);

const decisionsByKind = new Map(
  presenters.map(({ streamKind, publicNames }) => [streamKind, Object.keys(publicNames).toSorted()]),
);

const awkward = '\u0000'.repeat(64 * 1024);

const context: Context = {
  at: '2026-10-01T09:00:00.000Z',
  by: 'acme-admin',
  runId,
  definitionType: longestType,
  definitionName: 'n'.repeat(48),
  definitionVersion: Number.MAX_SAFE_INTEGER,
};

const largestJson = { text: 'x'.repeat(mostResultBytes - 16) };

const manyIssues = Array.from({ length: 100 }, () => ({ detail: awkward, pointer: awkward }));

const largestCall = {
  number: Number.MAX_SAFE_INTEGER,
  call_id: awkward,
  server: awkward,
  tool: awkward,
  arguments_bytes: Number.MAX_SAFE_INTEGER,
  arguments_sha256: awkward,
  content_kept: true,
};

const largestAnswer = {
  number: Number.MAX_SAFE_INTEGER,
  result_bytes: Number.MAX_SAFE_INTEGER,
  result_sha256: awkward,
  content_kept: true,
  duration_ms: Number.MAX_SAFE_INTEGER,
  jsonrpc_id: awkward,
  server_request_id: awkward,
};

const largestReply = { server: awkward, tool: awkward, reply: { id: awkward, sender: awkward } };

const largestRunEvents: readonly RunEvent[] = [
  { type: 'run_started', data: { input: { text: 'x'.repeat(mostInputBytes - 16) } } },
  { type: 'run_succeeded', data: { output: largestJson, record: largestJson } },
  {
    type: 'run_rejected',
    data: { rejection: { reason: 'invalid_input', detail: awkward, issues: manyIssues }, record: largestJson },
  },
  {
    type: 'run_rejected',
    data: {
      rejection: {
        reason: 'unavailable',
        detail: awkward,
        kind: 'model_not_offered',
        because: 'provider_not_configured',
      },
    },
  },
  { type: 'run_rejected', data: { rejection: { reason: 'conflict', detail: awkward } } },
  { type: 'run_failed', data: { incident: awkward } },
  { type: 'run_cancel_requested', data: { kind: 'requested', reason: awkward } },
  { type: 'tool_call_started', data: largestCall },
  { type: 'tool_call_answered', data: { ...largestAnswer, is_error: true } },
  {
    type: 'tool_call_failed',
    data: {
      number: 1,
      because: 'server_failure',
      detail: awkward,
      duration_ms: 1,
      jsonrpc_id: awkward,
      server_request_id: awkward,
    },
  },
  { type: 'delivery_started', data: { ...largestCall, target: awkward } },
  {
    type: 'delivery_succeeded',
    data: {
      ...largestAnswer,
      delivered_as: { conversation: awkward, id: awkward },
      replies_in: { server: awkward, tool: awkward, key: awkward },
    },
  },
  { type: 'delivery_failed', data: { ...largestAnswer, because: 'tool_error', detail: awkward, retry_after_ms: 1 } },
  { type: 'delivery_refused', data: { number: 1, because: 'too_large', detail: awkward, duration_ms: 1 } },
  { type: 'reply_taken', data: { ...largestReply, answer: largestJson } },
  { type: 'reply_refused', data: { ...largestReply, because: 'invalid', issues: manyIssues, told: true } },
];

const largestContent = {
  source: '😀'.repeat(16 * 1024),
  description: awkward,
  input_schema: largestJson,
  output_schema: largestJson,
  warnings: Array.from({ length: 10_000 }, () => awkward.slice(0, 100)),
};

const largestDefinitionEvents: readonly DefinitionEvent[] = [
  { type: 'definition_created', data: { content: largestContent } },
  { type: 'definition_updated', data: { content: largestContent } },
  { type: 'definition_retired', data: {} },
];

const awkwardText = (most: number) => '"'.repeat(most);

const largestEventPublished: EventPublished = {
  type: 'event_published',
  data: {
    event: {
      specversion: '1.0',
      id: awkwardText(256),
      source: 'x'.repeat(1024),
      type: awkwardText(256),
      subject: awkwardText(1024),
      time: '2026-10-01T09:00:00.123456789+02:00',
      data: { text: 'x'.repeat(200 * 1024) },
    },
    filled: ['id', 'time'],
  },
};

const decodePublicEvent = Schema.decodeUnknownResult(PublicEventSchema);

const utf8 = new TextEncoder();

const showing = { streamPrefix: 'brain/acme/alpha/', content: () => awkward, view: 'page' } as const;

function recordOf(stream: string, type: string, data: unknown): RecordedEvent {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: null,
    correlationId: null,
    stream,
    version: 1,
    globalPosition: 1,
    type,
    data,
    context,
    recordedAt: context.at,
  };
}

function presentedSizeOf(record: RecordedEvent): readonly [bytes: number, conforms: boolean] {
  const [presented] = present(record, showing);
  return [utf8.encode(JSON.stringify(presented?.data)).byteLength, Result.isSuccess(decodePublicEvent(presented))];
}

describe('the presenters of the stream kinds of a brain', () => {
  it.each(catalog)('decide on every stored type of the events of $stream', ({ stream, storedTypes }) => {
    expect(decisionsByKind.get(streamKindOf(stream))).toEqual(storedTypes.toSorted());
  });

  it('hide a stream kind none of them presents', () => {
    expect(present(recordOf(`run-logs/${runId}`, 'run_failed', {}), showing)).toEqual([]);
  });
});

describe('the largest record of every stored type', () => {
  it.each(largestRunEvents.map((event) => [event.type, event] as const))(
    'of a run, %s, presents within the bound of public data',
    (type, event) => {
      const [bytes, conforms] = presentedSizeOf(recordOf(runStream, type, event.data));

      expect(bytes).toBeLessThanOrEqual(mostPublicEventDataBytes);
      expect(conforms).toBe(true);
    },
  );

  it.each(largestDefinitionEvents.map((event) => [event.type, event] as const))(
    'of the definitions of a capability, %s, presents within the bound of public data',
    (type, event) => {
      const [bytes, conforms] = presentedSizeOf(recordOf(definitionStream, type, event.data));

      expect(bytes).toBeLessThanOrEqual(mostPublicEventDataBytes);
      expect(conforms).toBe(true);
    },
  );

  it('of an event published to the brain presents within the bound of public data', () => {
    const [bytes, conforms] = presentedSizeOf(
      recordOf(eventStream, largestEventPublished.type, largestEventPublished.data),
    );

    expect(bytes).toBeLessThanOrEqual(mostPublicEventDataBytes);
    expect(conforms).toBe(true);
  });
});
