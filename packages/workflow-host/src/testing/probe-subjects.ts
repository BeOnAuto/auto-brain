import type {
  RecordStoreSubject,
  RunStoreSubject,
  TimerSubject,
  WatermarkSubject,
} from '@beonauto/workflow-engine/testing';
import { Effect, Function } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { ledgerRunStore } from '../runs/ledger-run-store.ts';
import { ledgerRecordStore } from '../settlement/ledger-record-store.ts';
import { sqlTimers } from '../timers/sql-timers.ts';
import { knownExecutions } from './known-executions.ts';

export const runId = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherRunId = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

export const startedAt = 1_790_845_200_000;

export function timerSubjectOn(database: HostDatabase): TimerSubject {
  const clock = { now: startedAt };
  const table = sqlTimers(database, Function.constVoid);
  return {
    timers: table.timers,
    run: { executionId: runId, attributes: {} },
    otherRun: { executionId: otherRunId, attributes: {} },
    now: () => clock.now,
    settle: () =>
      Effect.gen(function* () {
        clock.now += 3_600_000;
        const due = yield* table.due(clock.now, 100);
        yield* Effect.forEach(due, (timer) => table.fired(timer), { discard: true });
        return due.map(({ timerId }) => timerId);
      }),
  };
}

export function recordStoreSubjectOn(database: HostDatabase): RecordStoreSubject {
  const { settle, know } = knownExecutions();
  return {
    recordStore: ledgerRecordStore(database, { settle, note: Effect.logWarning, now: Date.now }),
    run: { executionId: runId, attributes: {} },
    know: (executionId) =>
      Effect.sync(() => {
        know(executionId.slice(executionId.lastIndexOf('/') + 1));
      }),
  };
}

export function watermarkSubjectOn(database: HostDatabase): WatermarkSubject {
  return { watermark: sqlWatermark(database), runStore: ledgerRunStore(database), executionId: runId };
}

export function runStoreSubjectOn(database: HostDatabase): RunStoreSubject {
  return { runStore: ledgerRunStore(database), executionId: runId };
}
