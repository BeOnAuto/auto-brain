import { outcomeOf, staleReasonOf } from '../machine/admission.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunDecision } from './run-loop.ts';
import type { Submission } from './workflow-engine.ts';

export function submissionOf({ events, loaded, version }: RunDecision, input: RunInput): Submission {
  return { outcome: events.length > 0 ? 'applied' : outcomeOf(staleReasonOf(loaded.state, input)), version };
}
