import { setTimeout } from 'node:timers/promises';

import type { Run, SettleExecution } from '@beonauto/specs';
import { defaultLimits, defaultSeed, testMachine } from '@beonauto/workflow-engine/testing';
import { Effect, Function, type Schema } from 'effect';

import type { DatabaseSettings } from '../src/database/host-databases.ts';
import type { RunStart } from '../src/host/run-requests.ts';
import { openWorkflowHost, type WorkflowHost } from '../src/host/workflow-host.ts';
import type { HostClock } from '../src/loop/host-clock.ts';
import { recordedReactions } from '../src/reaction-testing/recorded-reactions.ts';

export interface MeasuredHost {
  readonly host: WorkflowHost;
  readonly settled: () => number;
  readonly untilSettled: (count: number) => Promise<void>;
}

const execution: Run = {
  execution_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  primitive: 'orchestration',
  name: 'measured',
  spec_version: 1,
  status: 'succeeded',
  started_at: '2026-10-05T09:00:00.000Z',
  started_by: 'acme-admin',
};

export const header = { dsl: '1.0.3', namespace: 'acme', name: 'measured', version: '1.0.0' };

export function startOf(document: Schema.JsonObject, input: Schema.Json = {}): RunStart {
  return { document, input, limits: defaultLimits, attributes: {}, seed: defaultSeed };
}

export function runAt(index: number): { readonly org: string; readonly brain: string; readonly executionId: string } {
  return { org: 'acme', brain: 'alpha', executionId: `0199a3c4-7d2e-7c1a-9b3f-${String(index).padStart(12, '0')}` };
}

export async function measuredHost(database: DatabaseSettings, clock?: HostClock): Promise<MeasuredHost> {
  const counts = { settled: 0 };
  const settle: SettleExecution = () =>
    Effect.sync(() => {
      counts.settled += 1;
      return execution;
    });
  const host = await openWorkflowHost({
    database,
    machine: testMachine,
    perform: () => Effect.succeed({ status: 'succeeded', output: null }),
    settle,
    reports: {
      unsettled: () => Effect.void,
      trouble: Effect.logWarning,
      lostConnection: Function.constVoid,
      note: () => Effect.void,
    },
    sweepEveryMs: 1000,
    mostCallsAtOnce: 32,
    reactions: recordedReactions().options,
    ...(clock === undefined ? {} : { clock }),
  });
  const untilSettled = async (count: number): Promise<void> => {
    if (counts.settled < count) {
      await setTimeout(5);
      await untilSettled(count);
    }
  };
  return { host, settled: () => counts.settled, untilSettled };
}
