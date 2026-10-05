import { Effect } from 'effect';

import type { ToolCallFact, ToolCallJournal } from '../index.ts';

export interface RecordingJournal extends ToolCallJournal {
  readonly recorded: () => readonly ToolCallFact[];
}

export function recordingJournal(refusing: (fact: ToolCallFact) => boolean = () => false): RecordingJournal {
  const facts: ToolCallFact[] = [];
  return {
    record: (fact) =>
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
