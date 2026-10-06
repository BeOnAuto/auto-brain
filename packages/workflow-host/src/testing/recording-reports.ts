import { Conflict, type Lineage, type Settlement } from '@beonauto/operations';
import type { Emission, SettleExecution } from '@beonauto/specs';
import { Effect } from 'effect';

import type { HostNote, HostReports } from '../host/host-reports.ts';
import { triggerOfSource } from '../reaction-testing/brain-writes.ts';
import { StartRefused, type ReactionOptions, type ReactionStart, type Trigger } from '../reactions/reaction-options.ts';
import { knownExecutions } from './known-executions.ts';

export interface RecordingReports {
  readonly reports: HostReports;
  readonly troubles: () => readonly string[];
  readonly notes: () => readonly HostNote[];
}

export interface RecordingSettlements {
  readonly settle: SettleExecution;
  readonly settlements: () => ReadonlyMap<string, Settlement>;
  readonly lineages: () => ReadonlyMap<string, Lineage | undefined>;
  readonly attempts: () => number;
  readonly know: (executionId: string) => void;
}

const ledgerUnreachable = new Conflict({ detail: 'The ledger cannot be reached' });

export function recordingReports(): RecordingReports {
  const troubles: string[] = [];
  const notes: HostNote[] = [];
  const noted = (line: unknown): void => {
    troubles.push(String(line));
  };
  return {
    reports: {
      unsettled: ({ executionId, receipt }) =>
        Effect.sync(() => {
          noted(`${executionId} ${receipt}`);
        }),
      trouble: (what) =>
        Effect.sync(() => {
          noted(what);
        }),
      lostConnection: noted,
      note: (note) =>
        Effect.sync(() => {
          notes.push(note);
        }),
    },
    troubles: () => troubles,
    notes: () => notes,
  };
}

export function recordingSettlements(ledgerDown: () => boolean): RecordingSettlements {
  const settled = new Map<string, Settlement>();
  const lineages = new Map<string, Lineage | undefined>();
  const counts = { attempts: 0 };
  const { settle, know } = knownExecutions();
  return {
    settle: (address, settlement, lineage) =>
      Effect.suspend(() => {
        counts.attempts += 1;
        return ledgerDown() ? Effect.fail(ledgerUnreachable) : settle(address, settlement);
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            settled.set(address.id, settlement);
            lineages.set(address.id, lineage);
          }),
        ),
      ),
    settlements: () => settled,
    lineages: () => lineages,
    attempts: () => counts.attempts,
    know,
  };
}

export interface RecordedReactions {
  readonly options: ReactionOptions;
  readonly starts: () => readonly ReactionStart[];
  readonly emissions: () => readonly Emission[];
}

export interface ReactionBehaviour {
  readonly triggerOf?: (source: string) => Trigger | undefined;
  readonly refusesStarts?: () => boolean;
}

export function recordedReactions(behaviour: ReactionBehaviour = {}): RecordedReactions {
  const starts: ReactionStart[] = [];
  const emissions: Emission[] = [];
  return {
    options: {
      primitive: 'orchestration',
      triggerOf: behaviour.triggerOf ?? triggerOfSource,
      start: (start) =>
        Effect.suspend(() => {
          if (behaviour.refusesStarts?.() === true) {
            return Effect.fail(new StartRefused({ detail: 'The brain refused the start' }));
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
