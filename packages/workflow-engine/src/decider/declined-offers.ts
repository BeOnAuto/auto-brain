import { describeError } from '../dsl/raised-error.ts';
import { staleReasonOf } from '../machine/admission.ts';
import { inputTimeOf } from '../machine/input-receipt.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { resultOf } from './input-result.ts';

export function declinedOfferOf(options: MachineOptions, input: RunInput, state: RunState): string | undefined {
  if (input.kind !== 'event_offered' || staleReasonOf(state, input) !== undefined) {
    return undefined;
  }
  const { offer } = resultOf(state, inputTimeOf(state, input), options, input);
  return offer?.kind === 'failed' ? describeError(offer.error) : undefined;
}
