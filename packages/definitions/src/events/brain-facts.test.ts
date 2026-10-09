import type { RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionEvent } from '../registry/definition-events.ts';
import { definitionsDecider, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { jsonBytesOf } from '../runs/recorded-size.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { brainEventOf, brainFactOf } from './brain-facts.ts';
import { CloudEventSchema, mostPublishedEventBytes } from './cloud-event.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const recordId = 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEyIl0';

const fact = { by: 'acme-admin', at: '2026-10-01T09:00:05.000Z' };

const ofSummary = { definition_type: 'reasoning', name: 'summary', definition_version: 3 };

const encodeRunEvent = Schema.encodeSync(Schema.toCodecJson(runDecider.eventSchema));

const encodeDefinitionEvent = Schema.encodeSync(Schema.toCodecJson(definitionsDecider('reasoning').eventSchema));

const isCloudEvent = Schema.is(CloudEventSchema);

function ofRun(event: RunEvent): RecordedEvent {
  return {
    id: recordId,
    cursor: recordId,
    causationId: null,
    correlationId: null,
    stream: runStreamNameOf(runId),
    version: 1,
    type: event.type,
    data: encodeRunEvent(event),
    recordedAt: fact.at,
  };
}

function ofDefinitions(event: DefinitionEvent): RecordedEvent {
  return {
    id: recordId,
    cursor: recordId,
    causationId: null,
    correlationId: null,
    stream: definitionTypeStreamOf('reasoning'),
    version: 1,
    type: event.type,
    data: encodeDefinitionEvent(event),
    recordedAt: fact.at,
  };
}

const aboutTheRun = {
  specversion: '1.0',
  id: recordId,
  source: `/runs/${runId}`,
  subject: 'reasoning/summary',
  time: fact.at,
};

const ofTheRun = { definition_type: 'reasoning', name: 'summary', version: 3, caller: 'acme-admin', depth: 0 };

describe('the facts of a run as events', () => {
  it('are its start and its endings, about the run, from the record and its time, naming what ran', () => {
    const facts = [
      ofRun({ type: 'run_started', ...ofSummary, input: { text: 'the quarter' }, ...fact }),
      ofRun({
        type: 'run_rejected',
        rejection: { reason: 'unavailable', detail: 'Busy' },
        ...ofSummary,
        ...fact,
      }),
      ofRun({ type: 'run_failed', ...ofSummary, ...fact }),
    ].map((recorded) => brainFactOf(recorded));

    expect(facts).toEqual([
      { ...aboutTheRun, type: 'run_started', data: ofTheRun },
      { ...aboutTheRun, type: 'run_rejected', data: { ...ofTheRun, reason: 'unavailable' } },
      { ...aboutTheRun, type: 'run_failed', data: ofTheRun },
    ]);
    expect(facts.every((event) => isCloudEvent(event))).toBe(true);
  });

  it('carry the output of a success that fits an event', () => {
    const output = { summary: 'Profits rose.' };

    expect(
      brainFactOf(ofRun({ type: 'run_succeeded', output, record: { model: 'm' }, ...ofSummary, ...fact })),
    ).toEqual({ ...aboutTheRun, type: 'run_succeeded', data: { ...ofTheRun, output } });
  });
});

function deep(levels: number): Schema.Json {
  return levels === 0 ? 'rose' : { profits: deep(levels - 1) };
}

describe('the output a success carries as an event', () => {
  it('is its size when it is too large for an event, which get_run reads whole', () => {
    const output = { summary: 'x'.repeat(mostPublishedEventBytes) };

    const succeeded = brainFactOf(ofRun({ type: 'run_succeeded', output, record: {}, ...ofSummary, ...fact }));

    expect(succeeded).toEqual({
      ...aboutTheRun,
      type: 'run_succeeded',
      data: { ...ofTheRun, output_bytes: jsonBytesOf(output) },
    });
  });

  it('is its size when it nests too deep for a run to hold the event in a list', () => {
    expect(
      brainFactOf(ofRun({ type: 'run_succeeded', output: deep(509), record: {}, ...ofSummary, ...fact })),
    ).toHaveProperty('data.output', deep(509));
    expect(
      brainFactOf(ofRun({ type: 'run_succeeded', output: deep(510), record: {}, ...ofSummary, ...fact })),
    ).toHaveProperty('data.output_bytes', jsonBytesOf(deep(510)));
  });

  it('is the output at the bound of an event, and its size one byte past it', () => {
    const empty = { ...aboutTheRun, type: 'run_succeeded', data: { ...ofTheRun, output: '' } };
    const room = mostPublishedEventBytes - jsonBytesOf(empty);
    const fitting = 'x'.repeat(room);

    expect(
      brainFactOf(ofRun({ type: 'run_succeeded', output: fitting, record: {}, ...ofSummary, ...fact })),
    ).toHaveProperty('data.output', fitting);
    expect(
      brainFactOf(ofRun({ type: 'run_succeeded', output: `${fitting}x`, record: {}, ...ofSummary, ...fact })),
    ).toHaveProperty('data.output_bytes', room + 3);
  });
});

describe('the records of a run that are no facts', () => {
  it('are its deferrals, its cancel requests and its tool calls', () => {
    expect(brainFactOf(ofRun({ type: 'run_deferred', record: { run: 'r-1' }, ...ofSummary, ...fact }))).toBeUndefined();
    expect(
      brainFactOf(ofRun({ type: 'run_cancel_requested', kind: 'requested', reason: 'No', ...ofSummary, ...fact })),
    ).toBeUndefined();
    expect(
      brainFactOf(
        ofRun({
          type: 'tool_call_started',
          number: 1,
          call_id: 'toolu_01',
          server: 'graph',
          tool: 'search',
          arguments_bytes: 2,
          arguments_sha256: 'a'.repeat(64),
          ...fact,
        }),
      ),
    ).toBeUndefined();
  });
});

const content = { source: '---\nmodel: anthropic/claude-sonnet-4-5\n---\nSummarize.' };

describe('the facts of a definition as events', () => {
  it('are its creation, its changes and its retirement, about the definition', () => {
    const facts = [
      ofDefinitions({ type: 'definition_created', name: 'summary', version: 1, content, ...fact }),
      ofDefinitions({ type: 'definition_updated', name: 'summary', version: 2, content, ...fact }),
      ofDefinitions({ type: 'definition_retired', name: 'summary', ...fact }),
    ].map((recorded) => brainFactOf(recorded));

    const aboutTheDefinition = {
      specversion: '1.0',
      id: recordId,
      source: '/definitions/reasoning/summary',
      time: fact.at,
    };

    expect(facts).toEqual([
      {
        ...aboutTheDefinition,
        type: 'definition_created',
        data: { definition_type: 'reasoning', name: 'summary', version: 1, caller: 'acme-admin' },
      },
      {
        ...aboutTheDefinition,
        type: 'definition_updated',
        data: { definition_type: 'reasoning', name: 'summary', version: 2, caller: 'acme-admin' },
      },
      {
        ...aboutTheDefinition,
        type: 'definition_retired',
        data: { definition_type: 'reasoning', name: 'summary', caller: 'acme-admin' },
      },
    ]);
    expect(facts.every((event) => isCloudEvent(event))).toBe(true);
  });
});

const about = {
  id: recordId,
  cursor: recordId,
  causationId: null,
  correlationId: null,
  version: 1,
  recordedAt: fact.at,
};

describe('the records that are no facts of the brain', () => {
  it('are the records it cannot read as what their stream holds, which it answers with none, never a failure', () => {
    const unreadable: readonly RecordedEvent[] = [
      {
        ...about,
        stream: runStreamNameOf(runId),
        type: 'run_succeeded',
        data: { type: 'run_succeeded' },
      },
      { ...about, stream: definitionTypeStreamOf('reasoning'), type: 'definition_created', data: 'not an event' },
      { ...about, stream: runStreamNameOf(runId), type: 'run_started', data: null },
    ];

    expect(unreadable.map((record) => brainFactOf(record))).toEqual([undefined, undefined, undefined]);
  });

  it('are the run logs, the replies a run took or refused, and every other stream kind, tool tests and conversation reads among them', () => {
    const tested = { type: 'tool_test_started', test_id: '0199b7e2', server: 'graph', tool: 'search', at: fact.at };
    const read = { type: 'replies_read', call_id: '0199b7e3', server: 'chat', tool: 'thread_replies', at: fact.at };
    const reply = {
      server: 'chat',
      tool: 'thread_replies',
      reply: { id: '1699.2', sender: 'ada' },
      ...ofSummary,
      ...fact,
    };
    const others: readonly RecordedEvent[] = [
      { ...about, stream: `run-logs/${runId}`, type: 'input_applied', data: {} },
      { ...about, stream: 'events/0199a3c4', type: 'event_published', data: {} },
      { ...about, stream: 'tool-tests/0199b7e2', type: 'tool_test_started', data: tested },
      { ...about, stream: 'conversation-calls/0199b7e3', type: 'replies_read', data: read },
      ofRun({ type: 'reply_taken', ...reply, answer: { choice: 'approve' } }),
      ofRun({ type: 'reply_refused', ...reply, because: 'not_an_answer', told: false }),
    ];

    expect(others.filter((record) => brainFactOf(record) !== undefined)).toEqual([]);
  });
});

describe('the cause and the run of a fact', () => {
  it('are the extension attributes causationid and correlationid, when the record has them', () => {
    const caused = {
      ...ofRun({ type: 'run_failed', ...ofSummary, ...fact }),
      causationId: 'c-1',
      correlationId: 'r-1',
    };
    const correlated = { ...ofRun({ type: 'run_failed', ...ofSummary, ...fact }), correlationId: 'r-1' };

    expect([brainFactOf(caused), brainFactOf(correlated)]).toEqual([
      { ...aboutTheRun, type: 'run_failed', data: ofTheRun, causationid: 'c-1', correlationid: 'r-1' },
      { ...aboutTheRun, type: 'run_failed', data: ofTheRun, correlationid: 'r-1' },
    ]);
  });
});

const published = {
  specversion: '1.0',
  id: 'm-2026-09',
  source: '/ledger/eu',
  type: 'com.acme.ledger.month-closed',
  time: '2026-10-01T08:59:00Z',
  data: { region: 'eu' },
};
const ofPublished = (data: unknown, type = 'event_published'): RecordedEvent => ({
  id: recordId,
  cursor: recordId,
  causationId: 'c-1',
  correlationId: null,
  stream: 'events/0199a3c4',
  version: 1,
  type,
  data,
  recordedAt: fact.at,
});

describe('the events of a brain', () => {
  it('are the facts of the brain and the events published to it, as their publishers gave them', () => {
    expect(
      brainEventOf(
        ofPublished({ type: 'event_published', event: published, filled: [], by: 'acme-admin', at: fact.at }),
      ),
    ).toEqual(published);
    expect(brainEventOf(ofRun({ type: 'run_failed', ...ofSummary, ...fact }))).toEqual({
      ...aboutTheRun,
      type: 'run_failed',
      data: ofTheRun,
    });
  });

  it('leave out a published record that is not one, and a record of that stream of another type', () => {
    expect([brainEventOf(ofPublished({ type: 'event_published' })), brainEventOf(ofPublished({}, 'noted'))]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
