import type { Context, RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionEvent } from '../registry/definition-events.ts';
import { definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { runStreamNameOf } from '../runs/run-decider.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { testRunId as runId } from '../testing/run-facts.ts';
import { brainEventOf, brainFactOf } from './brain-facts.ts';
import { CloudEventSchema } from './cloud-event.ts';

const recordId = '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3';

const at = '2026-10-01T09:00:05.000Z';

const ofSummary: Context = {
  at,
  by: 'acme-admin',
  runId,
  definitionType: 'reasoning',
  definitionName: 'summary',
  definitionVersion: 3,
};

const isCloudEvent = Schema.is(CloudEventSchema);

const about = {
  id: recordId,
  cursor: recordId,
  causationId: null,
  correlationId: null,
  version: 1,
  globalPosition: 1,
  recordedAt: at,
};

function ofRun(event: RunEvent, context: Context = ofSummary): RecordedEvent {
  return { ...about, stream: runStreamNameOf(runId), type: event.type, data: event.data, context };
}

function ofDefinitions(event: DefinitionEvent, context: Context): RecordedEvent {
  return { ...about, stream: definitionTypeStreamOf('reasoning'), type: event.type, data: event.data, context };
}

const aboutTheRun = {
  specversion: '1.0',
  id: recordId,
  source: `/runs/${runId}`,
  subject: 'reasoning/summary',
  time: at,
  caller: 'acme-admin',
  definitionversion: 3,
};

describe('the facts of a run as events', () => {
  it('are its start and its endings, about the run, its context as attributes and its fact as data', () => {
    const facts = [
      ofRun({ type: 'run_started', data: { input: { text: 'the quarter' } } }),
      ofRun({ type: 'run_rejected', data: { rejection: { reason: 'unavailable', detail: 'Busy' } } }),
      ofRun({ type: 'run_rejected', data: { rejection: { reason: 'cancelled', kind: 'requested', detail: 'No' } } }),
      ofRun({ type: 'run_failed', data: {} }),
    ].map((recorded) => brainFactOf(recorded));

    expect(facts).toEqual([
      { ...aboutTheRun, type: 'run_started' },
      { ...aboutTheRun, type: 'run_rejected', data: { reason: 'unavailable' } },
      { ...aboutTheRun, type: 'run_rejected', data: { reason: 'cancelled', kind: 'requested' } },
      { ...aboutTheRun, type: 'run_failed' },
    ]);
    expect(facts.every((event) => isCloudEvent(event))).toBe(true);
  });

  it('carry every field of the chain of a run as an extension attribute', () => {
    const chained: Context = {
      ...ofSummary,
      by: 'brain:alpha',
      depth: 2,
      callDepth: 1,
      calledBy: { runId: '0199a3c4-7d2e-7c1a-9b3f-000000000001', reference: '/do/0/ask', run: 1 },
      trigger: { kind: 'event', reference: '/schedule/on' },
    };

    expect(brainFactOf(ofRun({ type: 'run_failed', data: {} }, chained))).toEqual({
      ...aboutTheRun,
      type: 'run_failed',
      caller: 'brain:alpha',
      depth: 2,
      calldepth: 1,
      calledby: '0199a3c4-7d2e-7c1a-9b3f-000000000001',
      triggerkind: 'event',
      triggerreference: '/schedule/on',
    });
  });
});

describe('the facts of a run as events, by what the run recorded', () => {
  it('carry the output of a success that fits an event, and no subject for a run recorded without its definition', () => {
    const output = { summary: 'Profits rose.' };
    const { at: time, by } = ofSummary;

    expect([
      brainFactOf(ofRun({ type: 'run_succeeded', data: { output, record: { model: 'm' } } })),
      brainFactOf(ofRun({ type: 'run_failed', data: {} }, { at: time, by })),
    ]).toEqual([
      { ...aboutTheRun, type: 'run_succeeded', data: { output } },
      { specversion: '1.0', id: recordId, source: `/runs/${runId}`, type: 'run_failed', time, caller: by },
    ]);
  });
});

describe('the records of a run that are no facts', () => {
  it('are its deferrals, its cancel requests, its tool calls and its replies', () => {
    const reply = { server: 'chat', tool: 'thread_replies', reply: { id: '1699.2', sender: 'ada' } };

    expect(
      [
        ofRun({ type: 'run_deferred', data: { record: { run: 'r-1' } } }),
        ofRun({ type: 'run_cancel_requested', data: { kind: 'requested', reason: 'No' } }),
        ofRun({ type: 'tool_call_failed', data: { number: 1, because: 'timed_out', duration_ms: 1, jsonrpc_id: 1 } }),
        ofRun({ type: 'reply_taken', data: { ...reply, answer: { choice: 'approve' } } }),
        ofRun({ type: 'reply_refused', data: { ...reply, because: 'not_an_answer', told: false } }),
      ].map((record) => brainFactOf(record)),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

const content = { source: '---\nmodel: anthropic/claude-sonnet-4-5\n---\nSummarize.' };

describe('the facts of a definition as events', () => {
  it('are its creation, its changes and its retirement, about the definition, with no subject and no data', () => {
    const named = { at, by: 'acme-admin', definitionType: 'reasoning', definitionName: 'summary' };
    const facts = [
      ofDefinitions({ type: 'definition_created', data: { content } }, { ...named, definitionVersion: 1 }),
      ofDefinitions({ type: 'definition_updated', data: { content } }, { ...named, definitionVersion: 2 }),
      ofDefinitions({ type: 'definition_retired', data: {} }, named),
    ].map((recorded) => brainFactOf(recorded));
    const aboutTheDefinition = {
      specversion: '1.0',
      id: recordId,
      source: '/definitions/reasoning/summary',
      time: at,
      caller: 'acme-admin',
    };

    expect(facts).toEqual([
      { ...aboutTheDefinition, type: 'definition_created', definitionversion: 1 },
      { ...aboutTheDefinition, type: 'definition_updated', definitionversion: 2 },
      { ...aboutTheDefinition, type: 'definition_retired' },
    ]);
    expect(facts.every((event) => isCloudEvent(event))).toBe(true);
  });
});

describe('the records that are no facts of the brain', () => {
  it('are the records it cannot read as what their stream holds, which it answers with none, never a failure', () => {
    const unreadable: readonly RecordedEvent[] = [
      { ...ofRun({ type: 'run_failed', data: {} }), data: { incident: 7 } },
      { ...ofDefinitions({ type: 'definition_created', data: { content } }, ofSummary), data: 'not an event' },
      { ...ofRun({ type: 'run_started', data: { input: {} } }), data: null },
    ];

    expect(unreadable.map((record) => brainFactOf(record))).toEqual([undefined, undefined, undefined]);
  });

  it('are the run logs and every other stream kind, tool tests and conversation reads among them', () => {
    const others: readonly RecordedEvent[] = [
      { ...about, stream: `run-logs/${runId}`, type: 'input_applied', data: {}, context: ofSummary },
      { ...about, stream: 'events/0199a3c4', type: 'event_published', data: {}, context: ofSummary },
      { ...about, stream: 'tool-tests/0199b7e2', type: 'tool_test_started', data: {}, context: ofSummary },
      { ...about, stream: 'conversation-calls/0199b7e3', type: 'replies_read', data: {}, context: ofSummary },
    ];

    expect(others.filter((record) => brainFactOf(record) !== undefined)).toEqual([]);
  });
});

describe('the cause and the run of a fact', () => {
  it('are the extension attributes causationid and correlationid, when the record has them', () => {
    const failed = ofRun({ type: 'run_failed', data: {} });

    expect([
      brainFactOf({ ...failed, causationId: 'c-1', correlationId: 'r-1' }),
      brainFactOf({ ...failed, correlationId: 'r-1' }),
    ]).toEqual([
      { ...aboutTheRun, type: 'run_failed', causationid: 'c-1', correlationid: 'r-1' },
      { ...aboutTheRun, type: 'run_failed', correlationid: 'r-1' },
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

function ofPublished(data: unknown, type = 'event_published'): RecordedEvent {
  return {
    ...about,
    causationId: 'c-1',
    stream: 'events/0199a3c4',
    type,
    data,
    context: { at, by: 'acme-admin' },
  };
}

describe('the events of a brain', () => {
  it('are the facts of the brain and the events published to it, as their publishers gave them', () => {
    expect([
      brainEventOf(ofPublished({ event: published, filled: [] })),
      brainEventOf(ofRun({ type: 'run_failed', data: {} })),
    ]).toEqual([published, { ...aboutTheRun, type: 'run_failed' }]);
  });

  it('leave out a published record that is not one, and a record of that stream of another type', () => {
    expect([brainEventOf(ofPublished({ filled: [] })), brainEventOf(ofPublished({}, 'noted'))]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
