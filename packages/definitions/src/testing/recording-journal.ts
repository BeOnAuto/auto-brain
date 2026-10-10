import type { CallEnded, CallStarted } from '@beonauto/mcp';
import { Effect } from 'effect';

import type { ToolCallJournal } from '../index.ts';

type JournalledFact =
  | { readonly number: number; readonly type: 'tool_call_started'; readonly data: CallStarted }
  | (CallEnded & { readonly number: number });

export interface RecordingJournal extends ToolCallJournal {
  readonly recorded: () => readonly JournalledFact[];
}

type Refusing = (fact: CallStarted | CallEnded) => boolean;

function refusingNothing(): boolean {
  return false;
}

export function recordingJournal(refusing: Refusing = refusingNothing): RecordingJournal {
  const facts: JournalledFact[] = [];
  const calls = { last: 0 };
  const numbered = (data: CallStarted): number => {
    calls.last += 1;
    facts.push({ number: calls.last, type: 'tool_call_started', data });
    return calls.last;
  };
  return {
    started: (fact) => Effect.sync(() => (refusing(fact) ? undefined : numbered(fact))),
    ended: (number, fact) =>
      Effect.sync(() => {
        if (refusing(fact)) {
          return false;
        }
        facts.push({ ...fact, number });
        return true;
      }),
    recorded: () => [...facts],
  };
}
