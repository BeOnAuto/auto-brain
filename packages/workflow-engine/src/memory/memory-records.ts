import type { Settlement } from '@beonauto/operations';
import { Effect } from 'effect';

import { DispatchFailed, type DispatchWatermark } from '../dispatch/dispatch-watermark.ts';
import { sameJson } from '../machine/same-json.ts';
import type { RecordStore, RunDue, RunReporter, SettleReceipt, UnsettledReport } from '../settlement/record-store.ts';
import type { Faults } from './memory-timers.ts';
import type { MemoryRunStore } from './run-store.ts';

export interface MemoryRecordStore extends RecordStore {
  readonly known: (executionId: string) => void;
  readonly settlementOf: (executionId: string) => Settlement | undefined;
}

export interface MemoryReporter extends RunReporter {
  readonly reports: () => readonly UnsettledReport[];
}

export function memoryRecordStore(faults: Faults): MemoryRecordStore {
  const known = new Set<string>();
  const settled = new Map<string, Settlement>();
  const dues = new Map<string, RunDue>();
  const recorded = (executionId: string, settlement: Settlement): SettleReceipt => {
    const earlier = settled.get(executionId);
    if (!known.has(executionId)) {
      return 'unknown_execution';
    }
    if (earlier === undefined) {
      settled.set(executionId, settlement);
      return 'recorded';
    }
    return sameJson(earlier, settlement) ? 'already_recorded' : 'settled_otherwise';
  };
  return {
    settle: (request) =>
      faults.attempt({ kind: 'settle', ...request }, () => recorded(request.executionId, request.settlement)),
    noteDue: (due) =>
      Effect.suspend(() => {
        if (faults.fails('note_due')) {
          return Effect.fail(
            new DispatchFailed({ output: 'note_due', detail: 'The record store was told to fail once' }),
          );
        }
        const noted = dues.get(due.executionId);
        if (noted === undefined || noted.version <= due.version) {
          dues.set(due.executionId, due);
        }
        return Effect.void;
      }),
    dueRuns: (before) =>
      Effect.sync(() =>
        [...dues.values()]
          .filter((due) => !settled.has(due.executionId))
          .filter(({ nextDueAt }) => nextDueAt !== null && nextDueAt < before)
          .map(({ executionId }) => executionId),
      ),
    known: (executionId) => {
      known.add(executionId);
    },
    settlementOf: (executionId) => settled.get(executionId),
  };
}

export function memoryReporter(): MemoryReporter {
  const reports: UnsettledReport[] = [];
  return {
    unsettled: (report) =>
      Effect.sync(() => {
        reports.push(report);
      }),
    reports: () => reports,
  };
}

interface Handouts {
  readonly takenAt: (executionId: string) => number;
  readonly handOut: (executionIds: readonly string[]) => readonly string[];
}

function handoutsOf(): Handouts {
  const taken = new Map<string, number>();
  const clock = { now: 0 };
  return {
    takenAt: (executionId) => taken.get(executionId) ?? 0,
    handOut: (executionIds) => {
      clock.now += 1;
      for (const executionId of executionIds) {
        taken.set(executionId, clock.now);
      }
      return executionIds;
    },
  };
}

export function memoryWatermark(runStore: Pick<MemoryRunStore, 'versions'>): DispatchWatermark {
  const marks = new Map<string, number>();
  const handouts = handoutsOf();
  const markOf = (executionId: string): number => marks.get(executionId) ?? 0;
  return {
    read: (executionId) => Effect.sync(() => markOf(executionId)),
    advance: (executionId, through) =>
      Effect.sync(() => {
        marks.set(executionId, Math.max(markOf(executionId), through));
      }),
    behindRuns: (limit) =>
      Effect.sync(() =>
        handouts.handOut(
          [...runStore.versions()]
            .filter(([executionId, version]: readonly [string, number]) => markOf(executionId) < version)
            .map(([executionId]: readonly [string, number]) => executionId)
            .toSorted((first, second) => handouts.takenAt(first) - handouts.takenAt(second))
            .slice(0, limit),
        ),
      ),
  };
}
