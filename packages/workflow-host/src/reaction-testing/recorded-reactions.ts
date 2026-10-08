import type { Emission } from '@beonauto/specs';
import { Effect } from 'effect';

import { StartRefused, type ReactionOptions, type ReactionStart } from '../reactions/reaction-options.ts';
import { StartRejected } from '../reactions/start-rejected.ts';

export interface RecordedReactions {
  readonly options: ReactionOptions;
  readonly starts: () => readonly ReactionStart[];
  readonly emissions: () => readonly Emission[];
}

export interface ReactionBehaviour {
  readonly failure?: FailingStart;
}

type StartFailure = StartRefused | StartRejected;

export type FailingStart = (start: ReactionStart) => StartFailure | null;

export function refusedWhile(refusing: Readonly<{ now: boolean }>): FailingStart {
  return () => (refusing.now ? new StartRefused({ detail: 'The brain refused the start' }) : null);
}

export function rejectedFor(workflow: string, detail: string): FailingStart {
  return (start) => (start.workflow === workflow ? new StartRejected({ detail }) : null);
}

export function recordedReactions(behaviour: ReactionBehaviour = {}): RecordedReactions {
  const starts: ReactionStart[] = [];
  const emissions: Emission[] = [];
  return {
    options: {
      primitive: 'orchestration',
      start: (start) =>
        Effect.suspend(() => {
          const failure = behaviour.failure?.(start) ?? null;
          if (failure !== null) {
            return Effect.fail(failure);
          }
          starts.push(start);
          return Effect.void;
        }),
      emit: (_brain, emission) =>
        Effect.sync(() => {
          emissions.push(emission);
          return 'recorded';
        }),
    },
    starts: () => starts,
    emissions: () => emissions,
  };
}
