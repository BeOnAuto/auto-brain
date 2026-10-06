import type { RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import type { ExecutionEvent } from '../execution/execution-events.ts';
import { jsonBytesOf } from '../execution/recorded-size.ts';
import type { SpecEvent } from '../registry/spec-events.ts';
import { specsDecider, specsStreamOf } from '../registry/specs-decider.ts';
import { brainFactOf } from './brain-facts.ts';
import { CloudEventSchema, mostPublishedEventBytes } from './cloud-event.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const recordId = 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEyIl0';

const fact = { by: 'acme-admin', at: '2026-10-01T09:00:05.000Z' };

const ofSummary = { primitive: 'inference', name: 'summary', spec_version: 3 };

const encodeExecutionEvent = Schema.encodeSync(Schema.toCodecJson(executionDecider.eventSchema));

const encodeSpecEvent = Schema.encodeSync(Schema.toCodecJson(specsDecider('inference').eventSchema));

const isCloudEvent = Schema.is(CloudEventSchema);

function ofRun(event: ExecutionEvent): RecordedEvent {
  return {
    id: recordId,
    stream: executionStreamOf(executionId),
    type: event.type,
    data: encodeExecutionEvent(event),
    recordedAt: fact.at,
  };
}

function ofSpecs(event: SpecEvent): RecordedEvent {
  return {
    id: recordId,
    stream: specsStreamOf('inference'),
    type: event.type,
    data: encodeSpecEvent(event),
    recordedAt: fact.at,
  };
}

const aboutTheRun = {
  specversion: '1.0',
  id: recordId,
  source: `/executions/${executionId}`,
  subject: 'inference/summary',
  time: fact.at,
};

const ofTheRun = { primitive: 'inference', name: 'summary', version: 3, caller: 'acme-admin' };

describe('the facts of a run as events', () => {
  it('are its start and its endings, about the run, from the record and its time, naming what ran', () => {
    const facts = [
      ofRun({ type: 'execution_started', ...ofSummary, input: { text: 'the quarter' }, ...fact }),
      ofRun({
        type: 'execution_rejected',
        rejection: { reason: 'unavailable', detail: 'Busy' },
        ...ofSummary,
        ...fact,
      }),
      ofRun({ type: 'execution_failed', ...ofSummary, ...fact }),
    ].map((recorded) => brainFactOf(recorded));

    expect(facts).toEqual([
      { ...aboutTheRun, type: 'execution_started', data: ofTheRun },
      { ...aboutTheRun, type: 'execution_rejected', data: ofTheRun },
      { ...aboutTheRun, type: 'execution_failed', data: ofTheRun },
    ]);
    expect(facts.every((event) => isCloudEvent(event))).toBe(true);
  });

  it('carry the output of a success that fits an event', () => {
    const output = { summary: 'Profits rose.' };

    expect(
      brainFactOf(ofRun({ type: 'execution_succeeded', output, record: { model: 'm' }, ...ofSummary, ...fact })),
    ).toEqual({ ...aboutTheRun, type: 'execution_succeeded', data: { ...ofTheRun, output } });
  });
});

function deep(levels: number): Schema.Json {
  return levels === 0 ? 'rose' : { profits: deep(levels - 1) };
}

describe('the output a success carries as an event', () => {
  it('is its size when it is too large for an event, which get_execution reads whole', () => {
    const output = { summary: 'x'.repeat(mostPublishedEventBytes) };

    const succeeded = brainFactOf(ofRun({ type: 'execution_succeeded', output, record: {}, ...ofSummary, ...fact }));

    expect(succeeded).toEqual({
      ...aboutTheRun,
      type: 'execution_succeeded',
      data: { ...ofTheRun, output_bytes: jsonBytesOf(output) },
    });
  });

  it('is its size when it nests too deep for a run to hold the event in a list', () => {
    expect(
      brainFactOf(ofRun({ type: 'execution_succeeded', output: deep(509), record: {}, ...ofSummary, ...fact })),
    ).toHaveProperty('data.output', deep(509));
    expect(
      brainFactOf(ofRun({ type: 'execution_succeeded', output: deep(510), record: {}, ...ofSummary, ...fact })),
    ).toHaveProperty('data.output_bytes', jsonBytesOf(deep(510)));
  });

  it('is the output at the bound of an event, and its size one byte past it', () => {
    const empty = { ...aboutTheRun, type: 'execution_succeeded', data: { ...ofTheRun, output: '' } };
    const room = mostPublishedEventBytes - jsonBytesOf(empty);
    const fitting = 'x'.repeat(room);

    expect(
      brainFactOf(ofRun({ type: 'execution_succeeded', output: fitting, record: {}, ...ofSummary, ...fact })),
    ).toHaveProperty('data.output', fitting);
    expect(
      brainFactOf(ofRun({ type: 'execution_succeeded', output: `${fitting}x`, record: {}, ...ofSummary, ...fact })),
    ).toHaveProperty('data.output_bytes', room + 3);
  });
});

describe('the records of a run that are no facts', () => {
  it('are its deferrals and its tool calls', () => {
    expect(brainFactOf(ofRun({ type: 'execution_deferred', record: { run: 'r-1' }, ...fact }))).toBeUndefined();
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
      ofSpecs({ type: 'spec_created', name: 'summary', version: 1, content, ...fact }),
      ofSpecs({ type: 'spec_updated', name: 'summary', version: 2, content, ...fact }),
      ofSpecs({ type: 'spec_retired', name: 'summary', ...fact }),
    ].map((recorded) => brainFactOf(recorded));

    const aboutTheDefinition = { specversion: '1.0', id: recordId, source: '/specs/inference/summary', time: fact.at };

    expect(facts).toEqual([
      {
        ...aboutTheDefinition,
        type: 'spec_created',
        data: { primitive: 'inference', name: 'summary', version: 1, caller: 'acme-admin' },
      },
      {
        ...aboutTheDefinition,
        type: 'spec_updated',
        data: { primitive: 'inference', name: 'summary', version: 2, caller: 'acme-admin' },
      },
      {
        ...aboutTheDefinition,
        type: 'spec_retired',
        data: { primitive: 'inference', name: 'summary', caller: 'acme-admin' },
      },
    ]);
    expect(facts.every((event) => isCloudEvent(event))).toBe(true);
  });
});

describe('the records that are no facts of the brain', () => {
  it('are the run logs and every other stream kind', () => {
    expect(
      brainFactOf({
        id: recordId,
        stream: `runs/${executionId}`,
        type: 'input_applied',
        data: {},
        recordedAt: fact.at,
      }),
    ).toBeUndefined();
    expect(
      brainFactOf({ id: recordId, stream: 'events/0199a3c4', type: 'event_published', data: {}, recordedAt: fact.at }),
    ).toBeUndefined();
  });
});
