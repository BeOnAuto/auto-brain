import type { RecordedEvent } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { stepOf, type StepParts } from './record-steps.ts';
import type { GateVerdict } from './run-gate.ts';

const brainKey = 'brain/acme/alpha/';

const parts: StepParts = {
  consumers: [],
  type: 'workflow',
  applyDefinitionRecord: () => Effect.succeed('applied'),
  unreadable: () => Effect.void,
  passedEarly: () => Effect.void,
  registered: [],
  calls: [],
};

const record: RecordedEvent = {
  id: 'record-1',
  cursor: 'cursor-1',
  causationId: null,
  correlationId: null,
  stream: `${brainKey}run-logs/r-1`,
  version: 1,
  type: 'input_applied',
  data: null,
  recordedAt: '2026-10-01T09:00:00.000Z',
};

const fresh = { cursor: null, delivered: null, attempts: 0, waiting: false };

function steppedPast(verdict: GateVerdict, wantsMore: boolean) {
  const gate = { verdictOn: () => Effect.succeed(verdict) };
  const stepping = {
    brainKey,
    gate,
    mode: 'signal' as const,
    delivers: new Set<string>(),
    wantsMore: () => Effect.succeed(wantsMore),
  };
  return Effect.runPromise(stepOf(parts, stepping, fresh, record));
}

describe('the step over the record of a run that passed listeners', () => {
  it('ends a pass when its listeners want records it did not read the data of, so the next reads it', async () => {
    const passed = { cursor: 'cursor-1', delivered: null, attempts: 0, waiting: false };

    expect([await steppedPast('listened', true), await steppedPast('listened', false)]).toEqual([
      { progress: passed, end: 'more' },
      { progress: passed },
    ]);
  });
});
