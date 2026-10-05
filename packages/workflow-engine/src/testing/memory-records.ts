import type { Settlement } from '@beonauto/operations';
import { Effect } from 'effect';

import type { DispatchWatermark } from '../dispatch/dispatch-watermark.ts';
import { sameJson } from '../machine/same-json.ts';
import type { RecordStore, RunDue, RunReporter, SettleReceipt, UnsettledReport } from '../settlement/record-store.ts';
import type { Faults } from './memory-timers.ts';

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
      Effect.sync(() => {
        const noted = dues.get(due.executionId);
        if (noted === undefined || noted.version <= due.version) {
          dues.set(due.executionId, due);
        }
      }),
    dueRuns: (before) =>
      Effect.sync(() =>
        [...dues.values()]
          .filter((due) => !settled.has(due.executionId))
          .filter(({ nextDueAt, behind }) => behind || (nextDueAt !== null && nextDueAt < before))
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

export function memoryWatermark(): DispatchWatermark {
  const marks = new Map<string, number>();
  return {
    read: (executionId) => Effect.sync(() => marks.get(executionId) ?? 0),
    advance: (executionId, through) =>
      Effect.sync(() => {
        marks.set(executionId, Math.max(marks.get(executionId) ?? 0, through));
      }),
  };
}
