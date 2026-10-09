import { Effect } from 'effect';

import type { CallAnsweredFact, CallStartedFact, ToolCallJournal } from '../index.ts';

type RecordedFact = (CallStartedFact & { readonly number: number }) | CallAnsweredFact;

export interface RecordingJournal extends ToolCallJournal {
  readonly recorded: () => readonly RecordedFact[];
}

export function recordingJournal(
  refusing: (fact: CallStartedFact | CallAnsweredFact) => boolean = () => false,
): RecordingJournal {
  const facts: RecordedFact[] = [];
  const calls = { last: 0 };
  const numbered = (fact: CallStartedFact): number => {
    calls.last += 1;
    facts.push({ ...fact, number: calls.last });
    return calls.last;
  };
  return {
    started: (fact) => Effect.sync(() => (refusing(fact) ? undefined : numbered(fact))),
    answered: (fact) =>
      Effect.sync(() => {
        if (refusing(fact)) {
          return false;
        }
        facts.push(fact);
        return true;
      }),
    recorded: () => [...facts],
  };
}
