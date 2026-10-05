import type { SettleExecution } from '@beonauto/specs';
import type { EnginePorts, Executor, Timers, TroublingReceipt } from '@beonauto/workflow-engine';
import type { Effect } from 'effect';

import type { Trouble } from '../calls/host-executor.ts';
import type { HostDatabase } from '../database/host-database.ts';
import { runSerialiser } from '../dispatch/run-serialiser.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { ledgerRunStore } from '../runs/ledger-run-store.ts';
import { addressOfRun, type RunAddress } from '../runs/run-address.ts';
import { ledgerRecordStore } from '../settlement/ledger-record-store.ts';

export interface UnsettledRun extends RunAddress {
  readonly receipt: TroublingReceipt;
}

export interface HostReports {
  readonly unsettled: (run: UnsettledRun) => Effect.Effect<void>;
  readonly trouble: Trouble;
  readonly lostConnection: (error: Readonly<Error>) => void;
}

export interface PortParts {
  readonly settle: SettleExecution;
  readonly reports: HostReports;
  readonly timers: Timers;
  readonly executor: Executor;
}

export function hostPortsOn(database: HostDatabase, { settle, reports, timers, executor }: PortParts): EnginePorts {
  return {
    runStore: ledgerRunStore(database),
    watermark: sqlWatermark(database),
    timers,
    executor,
    recordStore: ledgerRecordStore(database, settle),
    reporter: { unsettled: ({ run, receipt }) => reports.unsettled({ ...addressOfRun(run.executionId), receipt }) },
    serialiser: runSerialiser(),
  };
}
