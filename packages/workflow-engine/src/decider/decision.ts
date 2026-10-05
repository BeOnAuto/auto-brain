import { staleReasonOf } from '../machine/admission.ts';
import { inputTimeOf, receiptOf } from '../machine/input-receipt.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunEvent } from '../run-log/run-event.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { resultOf } from './input-result.ts';
import { brokenBound, inputsBound } from './run-bounds.ts';
import { endingEvent } from './run-endings.ts';
import { eventOf } from './run-events.ts';

function appliedEvent(state: RunState, options: MachineOptions, input: RunInput): RunEvent {
  const at = inputTimeOf(state, input);
  const result = resultOf(state, at, options, input);
  const event = eventOf(state, result, receiptOf(input, at));
  const broken = brokenBound(state, event, result);
  return broken === undefined ? event : endingEvent(state, options, input, broken);
}

export function decided(options: MachineOptions, input: RunInput, state: RunState): readonly RunEvent[] {
  if (staleReasonOf(state, input) !== undefined) {
    return [];
  }
  const tooMany = inputsBound(state);
  return [tooMany === undefined ? appliedEvent(state, options, input) : endingEvent(state, options, input, tooMany)];
}
