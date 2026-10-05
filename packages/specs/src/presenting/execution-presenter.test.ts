import { presentationOf, type RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ExecutionEventSchema, type ExecutionEvent } from '../execution/execution-events.ts';
import { makeSpecPresenters } from '../index.ts';
import { echo } from '../testing/echo.ts';

const { present } = presentationOf(makeSpecPresenters([echo]));

const encode = Schema.encodeSync(Schema.toCodecJson(ExecutionEventSchema));

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const fact = { by: 'acme-admin', at: '2026-10-01T09:00:01.000Z' };

function recorded(event: ExecutionEvent): RecordedEvent {
  return {
    id: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    stream: `executions/${executionId}`,
    type: event.type,
    data: encode(event),
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

function presented(event: ExecutionEvent) {
  return present(recorded(event));
}

const shown = { id: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ', at: '2026-10-01T09:00:01.000Z' };

describe('the presenter of the events of an execution', () => {
  it('presents a start with the spec that ran and the size of its input, at the time of the start', () => {
    expect(
      presented({
        type: 'execution_started',
        primitive: 'echo',
        name: 'greet',
        spec_version: 2,
        input: { who: 'Ada' },
        ...fact,
      }),
    ).toEqual({
      ...shown,
      type: 'execution_started',
      summary: 'A run of the greeting “greet” started.',
      data: {
        execution_id: executionId,
        by: 'acme-admin',
        primitive: 'echo',
        name: 'greet',
        spec_version: 2,
        input_bytes: 13,
      },
    });
  });
});

describe('the presenter of the end of an execution', () => {
  it('presents work that finishes later, and a success, with the sizes of what they recorded', () => {
    expect([
      presented({ type: 'execution_deferred', record: { run: 'r-1' }, ...fact }),
      presented({ type: 'execution_succeeded', output: 'Hello', record: {}, ...fact }),
    ]).toEqual([
      {
        ...shown,
        type: 'execution_deferred',
        summary: 'A run carries on by itself, and finishes later.',
        data: { execution_id: executionId, by: 'acme-admin', record_bytes: 13 },
      },
      {
        ...shown,
        type: 'execution_succeeded',
        summary: 'A run finished.',
        data: { execution_id: executionId, by: 'acme-admin', output_bytes: 7, record_bytes: 2 },
      },
    ]);
  });

  it('presents a failure without blame', () => {
    expect(presented({ type: 'execution_failed', ...fact })).toEqual({
      ...shown,
      type: 'execution_failed',
      summary: 'A run broke down because of a problem inside the server.',
      data: { execution_id: executionId, by: 'acme-admin' },
    });
  });
});

describe('the presenter of a rejected execution', () => {
  it('counts the issues of input it did not accept and shows the first five', () => {
    const issues = Array.from({ length: 6 }, (_, index) => ({ detail: `Issue ${index}`, pointer: `/field${index}` }));

    expect(
      presented({ type: 'execution_rejected', rejection: { reason: 'invalid_input', detail: 'Bad', issues }, ...fact }),
    ).toEqual({
      ...shown,
      type: 'execution_rejected',
      summary: 'A run did not go through: what was given does not fit what it needs.',
      data: {
        execution_id: executionId,
        by: 'acme-admin',
        reason: 'invalid_input',
        detail: 'Bad',
        issue_count: 6,
        issues: issues.slice(0, 5),
      },
    });
  });
});

describe('the presenter of an execution rejected for something it relies on', () => {
  it('shows the kind and the reason of something unavailable, when it was given', () => {
    const unavailable = { reason: 'unavailable', detail: 'No model' } as const;

    expect([
      presented({
        type: 'execution_rejected',
        rejection: { ...unavailable, kind: 'model_not_offered', because: 'model_not_allowed' },
        ...fact,
      }),
      presented({ type: 'execution_rejected', rejection: unavailable, ...fact }),
    ]).toMatchObject([
      {
        summary:
          'A run did not go through: this server does not offer the model named, because it is not among the models whoever runs the server allows.',
        data: { ...unavailable, kind: 'model_not_offered', because: 'model_not_allowed' },
      },
      {
        summary: 'A run did not go through: something the server relies on is not available right now.',
        data: { execution_id: executionId, by: 'acme-admin', ...unavailable },
      },
    ]);
  });

  it('shows a spec that cannot run as written, and cuts a long detail and caller at a code point', () => {
    const conflict = presented({
      type: 'execution_rejected',
      rejection: { reason: 'conflict', detail: '😀'.repeat(1000) },
      by: 'c'.repeat(300),
      at: fact.at,
    });

    expect(conflict).toMatchObject({
      summary: 'A run did not go through: it cannot work as it is written.',
      data: { reason: 'conflict', detail: '😀'.repeat(256), by: 'c'.repeat(256) },
    });
  });
});
