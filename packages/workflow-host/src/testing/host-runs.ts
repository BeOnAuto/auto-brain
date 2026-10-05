import type { CallResult, Settlement } from '@beonauto/operations';
import type { SettleExecution } from '@beonauto/specs';
import type { StartCall } from '@beonauto/workflow-engine';
import { testMachine } from '@beonauto/workflow-engine/testing';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { DatabaseSettings } from '../database/host-databases.ts';
import { openWorkflowHost, type HostOptions, type WorkflowHost } from '../host/workflow-host.ts';
import type { HostClock } from '../loop/host-clock.ts';
import { knownExecutions } from './known-executions.ts';

export interface HostedRuns {
  readonly host: WorkflowHost;
  readonly calls: () => readonly StartCall[];
  readonly settlements: () => ReadonlyMap<string, Settlement>;
  readonly troubles: () => readonly string[];
  readonly know: (executionId: string) => void;
}

export interface HostedOptions {
  readonly answer?: (call: StartCall) => Effect.Effect<CallResult>;
  readonly clock?: HostClock;
  readonly sweepEveryMs?: number;
}

const answeredWithNull = (): Effect.Effect<CallResult> => Effect.succeed({ status: 'succeeded', output: null });

export async function hostedOn(settings: DatabaseSettings, options: HostedOptions = {}): Promise<HostedRuns> {
  const performed: StartCall[] = [];
  const settled = new Map<string, Settlement>();
  const troubles: string[] = [];
  const noted = (line: unknown): void => {
    troubles.push(String(line));
  };
  const { settle, know } = knownExecutions();
  const recordingSettle: SettleExecution = (address, settlement) =>
    Effect.tap(settle(address, settlement), () =>
      Effect.sync(() => {
        settled.set(address.id, settlement);
      }),
    );
  const hostOptions: HostOptions = {
    database: settings,
    machine: testMachine,
    perform: (call) =>
      Effect.suspend(() => {
        performed.push(call);
        return (options.answer ?? answeredWithNull)(call);
      }),
    settle: recordingSettle,
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
    },
    sweepEveryMs: options.sweepEveryMs ?? 50,
    mostCallsAtOnce: 4,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  };
  const host = await openWorkflowHost(hostOptions);
  onTestFinished(() => host.stop());
  return { host, calls: () => performed, settlements: () => settled, troubles: () => troubles, know };
}
