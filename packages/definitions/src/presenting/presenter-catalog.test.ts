import {
  PublicEventSchema,
  mostPublicEventDataBytes,
  presentationOf,
  streamKindOf,
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

const fact = { by: awkward, at: '2026-10-01T09:00:00.000Z' };

const ofTheLongestNames = {
  definition_type: longestType,
  name: 'n'.repeat(48),
  definition_version: Number.MAX_SAFE_INTEGER,
};

const largestJson = { text: 'x'.repeat(mostResultBytes - 16) };

const manyIssues = Array.from({ length: 100 }, () => ({ detail: awkward, pointer: awkward }));

const largestRunEvents: readonly RunEvent[] = [
  {
    type: 'run_started',
    definition_type: longestType,
    name: 'n'.repeat(48),
    definition_version: Number.MAX_SAFE_INTEGER,
    input: { text: 'x'.repeat(mostInputBytes - 16) },
    ...fact,
  },
  { type: 'run_succeeded', output: largestJson, record: largestJson, ...ofTheLongestNames, ...fact },
  {
    type: 'run_rejected',
    rejection: { reason: 'invalid_input', detail: awkward, issues: manyIssues },
    record: largestJson,
    ...ofTheLongestNames,
    ...fact,
  },
  {
    type: 'run_rejected',
    rejection: {
      reason: 'unavailable',
      detail: awkward,
      kind: 'model_not_offered',
      because: 'provider_not_configured',
    },
    ...ofTheLongestNames,
    ...fact,
  },
  { type: 'run_rejected', rejection: { reason: 'conflict', detail: awkward }, ...ofTheLongestNames, ...fact },
  { type: 'run_failed', ...ofTheLongestNames, ...fact },
  {
    type: 'tool_call_started',
    number: Number.MAX_SAFE_INTEGER,
    call_id: awkward,
    server: awkward,
    tool: awkward,
    arguments_bytes: Number.MAX_SAFE_INTEGER,
    arguments_sha256: awkward,
    arguments_json: awkward,
    ...fact,
  },
  {
    type: 'tool_call_answered',
    number: Number.MAX_SAFE_INTEGER,
    outcome: 'server_failure',
    result_bytes: Number.MAX_SAFE_INTEGER,
    result_sha256: awkward,
    duration_ms: Number.MAX_SAFE_INTEGER,
    jsonrpc_id: awkward,
    server_request_id: awkward,
    result_json: awkward,
    ...fact,
  },
];

const largestContent = {
  source: '😀'.repeat(16 * 1024),
  description: awkward,
  input_schema: largestJson,
  output_schema: largestJson,
  warnings: Array.from({ length: 10_000 }, () => awkward.slice(0, 100)),
};

const largestDefinitionEvents: readonly DefinitionEvent[] = [
  { type: 'definition_created', name: 'n'.repeat(48), version: 1, content: largestContent, ...fact },
  {
    type: 'definition_updated',
    name: 'n'.repeat(48),
    version: Number.MAX_SAFE_INTEGER,
    content: largestContent,
    ...fact,
  },
  { type: 'definition_retired', name: 'n'.repeat(48), ...fact },
];

const awkwardText = (most: number) => '"'.repeat(most);

const largestEventPublished: EventPublished = {
  type: 'event_published',
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
  ...fact,
};

const encodeRunEvent = Schema.encodeSync(Schema.toCodecJson(runDecider.eventSchema));

const encodeDefinitionEvent = Schema.encodeSync(Schema.toCodecJson(definitionsOfTheLongestType.eventSchema));

const encodeEventPublished = Schema.encodeSync(Schema.toCodecJson(publishedEventDecider.eventSchema));

const decodePublicEvent = Schema.decodeUnknownResult(PublicEventSchema);

const utf8 = new TextEncoder();

function recordOf(stream: string, type: string, data: unknown): RecordedEvent {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: null,
    correlationId: null,
    stream,
    version: 1,
    type,
    data,
    recordedAt: fact.at,
  };
}

function presentedSizeOf(record: RecordedEvent): readonly [bytes: number, conforms: boolean] {
  const [presented] = present(record);
  return [utf8.encode(JSON.stringify(presented?.data)).byteLength, Result.isSuccess(decodePublicEvent(presented))];
}

describe('the presenters of the stream kinds of a brain', () => {
  it.each(catalog)('decide on every stored type of the events of $stream', ({ stream, storedTypes }) => {
    expect(decisionsByKind.get(streamKindOf(stream))).toEqual(storedTypes.toSorted());
  });

  it('hide a stream kind none of them presents', () => {
    const failed: RunEvent = { type: 'run_failed', ...ofTheLongestNames, by: 'acme-admin', at: fact.at };

    expect(present(recordOf(`run-logs/${runId}`, failed.type, encodeRunEvent(failed)))).toEqual([]);
  });
});

describe('the largest record of every stored type', () => {
  it.each(largestRunEvents.map((event) => [event.type, event] as const))(
    'of a run, %s, presents within the bound of public data',
    (type, event) => {
      const [bytes, conforms] = presentedSizeOf(recordOf(runStream, type, encodeRunEvent(event)));

      expect(bytes).toBeLessThanOrEqual(mostPublicEventDataBytes);
      expect(conforms).toBe(true);
    },
  );

  it.each(largestDefinitionEvents.map((event) => [event.type, event] as const))(
    'of the definitions of a capability, %s, presents within the bound of public data',
    (type, event) => {
      const [bytes, conforms] = presentedSizeOf(recordOf(definitionStream, type, encodeDefinitionEvent(event)));

      expect(bytes).toBeLessThanOrEqual(mostPublicEventDataBytes);
      expect(conforms).toBe(true);
    },
  );

  it('of an event published to the brain presents within the bound of public data', () => {
    const [bytes, conforms] = presentedSizeOf(
      recordOf(eventStream, largestEventPublished.type, encodeEventPublished(largestEventPublished)),
    );

    expect(bytes).toBeLessThanOrEqual(mostPublicEventDataBytes);
    expect(conforms).toBe(true);
  });
});
