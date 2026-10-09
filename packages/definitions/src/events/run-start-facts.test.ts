import type { RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { brainFactOf } from './brain-facts.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const fact = { by: 'brain:alpha', at: '2026-10-01T09:00:05.000Z' };

const ofCheck = { definition_type: 'workflow', name: 'check', definition_version: 1 };

const calledBy = { run_id: '0199a3c4-7d2e-7c1a-9b3f-000000000001', reference: '/do/0/check', run: 1 };

const encode = Schema.encodeSync(Schema.toCodecJson(runDecider.eventSchema));

function ofRun(event: RunEvent): RecordedEvent {
  return {
    id: 'record-1',
    cursor: 'record-1',
    causationId: null,
    correlationId: null,
    stream: runStreamNameOf(runId),
    version: 2,
    type: event.type,
    data: encode(event),
    recordedAt: fact.at,
  };
}

describe('the facts of a run that answers a call of another run', () => {
  it('name the call it answers, and its ending the reason and kind it was rejected with', () => {
    expect([
      brainFactOf(ofRun({ type: 'run_started', ...ofCheck, input: {}, called_by: calledBy, ...fact }))?.data,
      brainFactOf(
        ofRun({
          type: 'run_rejected',
          rejection: { reason: 'cancelled', detail: 'Out of time', kind: 'deadline' },
          ...ofCheck,
          called_by: calledBy,
          ...fact,
        }),
      )?.data,
      brainFactOf(
        ofRun({
          type: 'run_rejected',
          rejection: { reason: 'conflict', detail: 'Clashed' },
          ...ofCheck,
          ...fact,
        }),
      )?.data,
    ]).toEqual([
      { type: 'workflow', name: 'check', version: 1, caller: 'brain:alpha', depth: 0, called_by: calledBy },
      {
        type: 'workflow',
        name: 'check',
        version: 1,
        caller: 'brain:alpha',
        depth: 0,
        called_by: calledBy,
        reason: 'cancelled',
        kind: 'deadline',
      },
      { type: 'workflow', name: 'check', version: 1, caller: 'brain:alpha', depth: 0, reason: 'conflict' },
    ]);
  });
});

describe('the facts of a run a trigger started', () => {
  it('name the trigger, by its kind and its place in the document, on the start and on the ending', () => {
    const trigger = { kind: 'every' as const, reference: '/schedule/every' };
    const ofTheRun = {
      type: 'workflow',
      name: 'check',
      version: 1,
      caller: 'brain:alpha',
      depth: 0,
      trigger,
    };

    expect([
      brainFactOf(ofRun({ type: 'run_started', ...ofCheck, input: {}, trigger, ...fact }))?.data,
      brainFactOf(ofRun({ type: 'run_failed', ...ofCheck, trigger, ...fact }))?.data,
    ]).toEqual([ofTheRun, ofTheRun]);
  });
});
