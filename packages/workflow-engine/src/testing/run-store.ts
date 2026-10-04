import { VersionConflict } from '@beonauto/ledger';
import { Effect, Result } from 'effect';

import { staleReasonOf } from '../machine/admission.ts';
import { inputTimeOf, receiptOf } from '../machine/input-receipt.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import { newRun } from '../machine/run-state.ts';
import { RunEventSchema, withHistoryBytes, type PositionedEvent } from '../run-log/run-event.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import type { RunStore } from '../run-log/run-store.ts';
import { stateFormat } from '../run-log/state-format.ts';

export interface MemoryRunStore extends RunStore {
  readonly events: (executionId: string) => readonly PositionedEvent[];
}

export function memoryRunStore(conflicts = 0): MemoryRunStore {
  const streams = new Map<string, readonly PositionedEvent[]>();
  const remaining = { conflicts };
  const eventsOf = (executionId: string): readonly PositionedEvent[] => streams.get(executionId) ?? [];
  return {
    load: (executionId) => Effect.sync(() => ({ snapshot: null, tail: eventsOf(executionId) })),
    append: (executionId, event, expectedVersion) =>
      Effect.suspend(() => {
        remaining.conflicts -= 1;
        if (remaining.conflicts >= 0 || eventsOf(executionId).length !== expectedVersion) {
          return Effect.fail(new VersionConflict());
        }
        streams.set(executionId, [...eventsOf(executionId), { version: expectedVersion + 1, event }]);
        return Effect.void;
      }),
    eventsAfter: (executionId, version) => Effect.sync(() => eventsOf(executionId).slice(version)),
    saveSnapshot: () => Effect.void,
    events: eventsOf,
  };
}

export const countingDecider: RunDecider = {
  initialState: newRun,
  evolve: evolveRun,
  eventSchema: RunEventSchema,
  decide: (input, state) => {
    if (staleReasonOf(state, input) !== undefined) {
      return Result.succeed([]);
    }
    const at = inputTimeOf(state, input);
    const counted = withHistoryBytes(
      {
        type: 'input_applied',
        format: stateFormat,
        receipt: receiptOf(input, at),
        steps: [],
        patch: [
          { op: 'replace', path: '/executionId', value: input.executionId },
          { op: 'replace', path: '/status', value: 'running' },
          { op: 'replace', path: '/inputs', value: state.inputs + 1 },
          { op: 'replace', path: '/lastInputAt', value: at },
          { op: 'replace', path: '/cancelRequested', value: input.kind === 'cancel_requested' },
        ],
        outputs: [],
      },
      state.historyBytes,
    );
    return Result.succeed([counted]);
  },
};
