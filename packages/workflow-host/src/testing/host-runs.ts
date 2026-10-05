import type { CallResult, Settlement } from '@beonauto/operations';
import type { StartCall } from '@beonauto/workflow-engine';
import { testMachine } from '@beonauto/workflow-engine/testing';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { DatabaseSettings } from '../database/host-databases.ts';
import type { HostNote } from '../host/host-reports.ts';
import { openWorkflowHost, type WorkflowHost } from '../host/workflow-host.ts';
import type { HostClock } from '../loop/host-clock.ts';
import { recordingReports, recordingSettlements } from './recording-reports.ts';

export interface HostedRuns {
  readonly host: WorkflowHost;
  readonly calls: () => readonly StartCall[];
  readonly settlements: () => ReadonlyMap<string, Settlement>;
  readonly settleAttempts: () => number;
  readonly troubles: () => readonly string[];
  readonly notes: () => readonly HostNote[];
  readonly know: (executionId: string) => void;
}

export interface HostedOptions {
  readonly answer?: (call: StartCall) => Effect.Effect<CallResult>;
  readonly clock?: HostClock;
  readonly sweepEveryMs?: number;
  readonly ledgerDown?: () => boolean;
  readonly holder?: string;
}

const answeredWithNull = (): Effect.Effect<CallResult> => Effect.succeed({ status: 'succeeded', output: null });

const ledgerUp = (): boolean => false;

export async function hostedOn(settings: DatabaseSettings, options: HostedOptions = {}): Promise<HostedRuns> {
  const performed: StartCall[] = [];
  const recorded = recordingReports();
  const settling = recordingSettlements(options.ledgerDown ?? ledgerUp);
  const host = await openWorkflowHost({
    database: settings,
    machine: testMachine,
    perform: (call) =>
      Effect.suspend(() => {
        performed.push(call);
        return (options.answer ?? answeredWithNull)(call);
      }),
    settle: settling.settle,
    reports: recorded.reports,
    sweepEveryMs: options.sweepEveryMs ?? 50,
    mostCallsAtOnce: 4,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.holder === undefined ? {} : { holder: options.holder }),
  });
  onTestFinished(() => host.stop());
  return {
    host,
    calls: () => performed,
    settlements: settling.settlements,
    settleAttempts: settling.attempts,
    troubles: recorded.troubles,
    notes: recorded.notes,
    know: settling.know,
  };
}
