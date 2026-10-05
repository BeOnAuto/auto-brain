import { Effect } from 'effect';

import type { CallJournal, RecordedCall } from '../access/recorded-calls.ts';
import type { RunContext } from '../access/run-context.ts';
import type { CallSignals } from '../access/run-parts.ts';

export const toolRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export interface RecordingCallJournal extends CallJournal {
  readonly facts: () => readonly RecordedCall[];
  readonly refuseFromNowOn: () => void;
}

export interface ControlledSignals extends CallSignals {
  readonly end: () => void;
  readonly cancel: () => void;
}

export function inTurn<A, B>(items: readonly A[], step: (item: A) => Promise<B>): Promise<readonly B[]> {
  return items.reduce<Promise<readonly B[]>>(
    async (done, item) => [...(await done), await step(item)],
    Promise.resolve([]),
  );
}

export function recordingCallJournal(): RecordingCallJournal {
  const facts: RecordedCall[] = [];
  const state = { refusing: false };
  return {
    record: (fact) =>
      Effect.sync(() => {
        if (!state.refusing) {
          facts.push(fact);
        }
        return !state.refusing;
      }),
    facts: () => [...facts],
    refuseFromNowOn: () => {
      state.refusing = true;
    },
  };
}

export function toolRun(journal: CallJournal, changes: Partial<Omit<RunContext, 'journal'>> = {}): RunContext {
  return { id: toolRunId, org: 'acme', brain: 'alpha', ...changes, journal };
}

export function controlledSignals(): ControlledSignals {
  const ended = new AbortController();
  const cancelled = new AbortController();
  return {
    signal: AbortSignal.any([ended.signal, cancelled.signal]),
    cancelled: cancelled.signal,
    end: () => {
      ended.abort();
    },
    cancel: () => {
      cancelled.abort();
    },
  };
}
