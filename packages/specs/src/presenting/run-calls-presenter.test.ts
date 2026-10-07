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

const ofGreet = { primitive: 'echo', name: 'greet', spec_version: 2 };

function recorded(event: ExecutionEvent): RecordedEvent {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: '1c2d3e4f-5a6b-5c7d-8e9f-a0b1c2d3e4f5',
    correlationId: executionId,
    stream: `executions/${executionId}`,
    version: 1,
    type: event.type,
    data: encode(event),
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

function presented(event: ExecutionEvent) {
  return present(recorded(event)).at(0);
}

const shown = {
  id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
  cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
  causation_id: '1c2d3e4f-5a6b-5c7d-8e9f-a0b1c2d3e4f5',
  at: '2026-10-01T09:00:01.000Z',
};

describe('the presenter of a run that answers a call of another run', () => {
  it('shows the call it answers on its start, its reference cut at 256 bytes', () => {
    const calledBy = {
      execution_id: '0199a3c4-7d2e-7c1a-9b3f-000000000001',
      reference: `/do/0/${'x'.repeat(300)}`,
      run: 2,
    };

    expect(
      presented({
        type: 'execution_started',
        primitive: 'echo',
        name: 'greet',
        spec_version: 2,
        input: {},
        call_depth: 1,
        called_by: calledBy,
        ...fact,
      }),
    ).toMatchObject({
      data: { called_by: { ...calledBy, reference: calledBy.reference.slice(0, 256) } },
    });
  });
});

describe('the presenter of a cancel request', () => {
  it.each([
    ['requested', 'Someone allowed to change the brain asked for the run to be cancelled.'],
    ['deadline', 'The step that waited for the run ran out of time, so the run is being cancelled.'],
    ['parent_ended', 'The run that waited for this run ended first, so this run is being cancelled.'],
  ] as const)('says who asked for a cancel of the kind %s, with the reason cut at 1 KiB', (kind, summary) => {
    expect(
      presented({ type: 'execution_cancel_requested', kind, reason: 'r'.repeat(2000), ...ofGreet, ...fact }),
    ).toEqual({
      ...shown,
      type: 'execution_cancel_requested',
      summary,
      data: { execution_id: executionId, by: 'acme-admin', kind, reason: 'r'.repeat(1024) },
    });
  });

  it('shows a cancelled run with its kind, and a failure with its incident', () => {
    expect([
      presented({
        type: 'execution_rejected',
        rejection: { reason: 'cancelled', detail: 'Not needed', kind: 'requested' },
        ...ofGreet,
        ...fact,
      }),
      presented({ type: 'execution_failed', incident: 'incident-1', ...ofGreet, ...fact }),
    ]).toMatchObject([
      {
        summary: 'A run did not go through: it was cancelled at the request of someone allowed to change the brain.',
        data: { reason: 'cancelled', detail: 'Not needed', kind: 'requested' },
      },
      { summary: 'A run broke down because of a problem inside the server.', data: { incident: 'incident-1' } },
    ]);
  });
});
