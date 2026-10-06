import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunEvent } from '../run-log/run-event.ts';
import type { RecordCause, RecordLineage } from '../run-log/run-store.ts';

function causeOf(input: RunInput, { resumed }: RunEvent): RecordCause {
  if (input.kind === 'started') {
    return { kind: 'start' };
  }
  if (resumed !== undefined && resumed !== null) {
    return { kind: 'resumed', step: { ...resumed, outcome: 'waiting' } };
  }
  return input.kind === 'timer_fired' ? { kind: 'timer', timerId: input.timerId } : { kind: 'none' };
}

export function recordLineageOf(input: RunInput, state: RunState, event: RunEvent): RecordLineage {
  return {
    cause: causeOf(input, event),
    attributes: input.kind === 'started' ? input.attributes : state.attributes,
  };
}
