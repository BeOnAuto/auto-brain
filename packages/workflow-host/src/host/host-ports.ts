import type { SettleExecution } from '@beonauto/specs';
import type { EnginePorts, Executor, Timers } from '@beonauto/workflow-engine';

import type { HostDatabase } from '../database/host-database.ts';
import { runSerialiser } from '../dispatch/run-serialiser.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { ledgerRunStore } from '../runs/ledger-run-store.ts';
import { addressOfRun } from '../runs/run-address.ts';
import { ledgerRecordStore } from '../settlement/ledger-record-store.ts';
import type { HostReports } from './host-reports.ts';

export interface PortParts {
  readonly settle: SettleExecution;
  readonly reports: HostReports;
  readonly timers: Timers;
  readonly executor: Executor;
  readonly now: () => number;
}

export function hostPortsOn(
  database: HostDatabase,
  { settle, reports, timers, executor, now }: PortParts,
): EnginePorts {
  return {
    runStore: ledgerRunStore(database),
    watermark: sqlWatermark(database),
    timers,
    executor,
    recordStore: ledgerRecordStore(database, { settle, note: reports.note, now }),
    reporter: { unsettled: ({ run, receipt }) => reports.unsettled({ ...addressOfRun(run.executionId), receipt }) },
    serialiser: runSerialiser(),
  };
}
