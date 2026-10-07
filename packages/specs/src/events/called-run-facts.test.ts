import type { RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import type { ExecutionEvent } from '../execution/execution-events.ts';
import { brainFactOf } from './brain-facts.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const fact = { by: 'brain:alpha', at: '2026-10-01T09:00:05.000Z' };

const ofCheck = { primitive: 'orchestration', name: 'check', spec_version: 1 };

const calledBy = { execution_id: '0199a3c4-7d2e-7c1a-9b3f-000000000001', reference: '/do/0/check', run: 1 };

const encode = Schema.encodeSync(Schema.toCodecJson(executionDecider.eventSchema));

function ofRun(event: ExecutionEvent): RecordedEvent {
  return {
    id: 'record-1',
    cursor: 'record-1',
    causationId: null,
    correlationId: null,
    stream: executionStreamOf(executionId),
    version: 2,
    type: event.type,
    data: encode(event),
    recordedAt: fact.at,
  };
}

describe('the facts of a run that answers a call of another run', () => {
  it('name the call it answers, and its ending the reason and kind it was rejected with', () => {
    expect([
      brainFactOf(ofRun({ type: 'execution_started', ...ofCheck, input: {}, called_by: calledBy, ...fact }))?.data,
      brainFactOf(
        ofRun({
          type: 'execution_rejected',
          rejection: { reason: 'cancelled', detail: 'Out of time', kind: 'deadline' },
          ...ofCheck,
          called_by: calledBy,
          ...fact,
        }),
      )?.data,
      brainFactOf(
        ofRun({
          type: 'execution_rejected',
          rejection: { reason: 'conflict', detail: 'Clashed' },
          ...ofCheck,
          ...fact,
        }),
      )?.data,
    ]).toEqual([
      { primitive: 'orchestration', name: 'check', version: 1, caller: 'brain:alpha', depth: 0, called_by: calledBy },
      {
        primitive: 'orchestration',
        name: 'check',
        version: 1,
        caller: 'brain:alpha',
        depth: 0,
        called_by: calledBy,
        reason: 'cancelled',
        kind: 'deadline',
      },
      { primitive: 'orchestration', name: 'check', version: 1, caller: 'brain:alpha', depth: 0, reason: 'conflict' },
    ]);
  });
});
