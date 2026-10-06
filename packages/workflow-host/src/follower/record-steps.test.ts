import type { RecordedEvent } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { stepOf, type StepParts } from './record-steps.ts';
import type { GateVerdict } from './run-gate.ts';

const brainKey = 'brain/acme/alpha/';

const parts: StepParts = {
  consumers: [],
  primitive: 'orchestration',
  applySpecRecord: () => Effect.void,
  unreadable: () => Effect.void,
  passedEarly: () => Effect.void,
};

const record: RecordedEvent = {
  id: 'record-1',
  cursor: 'cursor-1',
  causationId: null,
  correlationId: null,
  stream: `${brainKey}runs/r-1`,
  version: 1,
  type: 'input_applied',
  data: null,
  recordedAt: '2026-10-01T09:00:00.000Z',
};

const fresh = { cursor: null, delivered: null, attempts: 0, waiting: false };

function steppedPast(verdict: GateVerdict, withData: boolean) {
  const gate = { verdictOn: () => Effect.succeed(verdict) };
  return Effect.runPromise(stepOf(parts, { brainKey, gate, mode: 'signal', withData }, fresh, record));
}

describe('the step over the record of a run that passed listeners', () => {
  it('ends a pass that read without data, so the next reads the events after it with their data', async () => {
    const passed = { cursor: 'cursor-1', delivered: null, attempts: 0, waiting: false };

    expect([await steppedPast('listened', false), await steppedPast('listened', true)]).toEqual([
      { progress: passed, end: 'more' },
      { progress: passed },
    ]);
  });
});
