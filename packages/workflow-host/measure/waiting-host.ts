import { setTimeout } from 'node:timers/promises';

import { streamSignalOf } from '@beonauto/ledger';
import type { SettleExecution } from '@beonauto/specs';
import { testMachine } from '@beonauto/workflow-engine/testing';
import { Effect, Function } from 'effect';

import { waitingCallsOf } from '../src/calls/call-rows.ts';
import type { DatabaseSettings } from '../src/database/host-databases.ts';
import { openWorkflowHost, type WorkflowHost } from '../src/host/workflow-host.ts';
import { recordedReactions } from '../src/reaction-testing/recorded-reactions.ts';
import { recordedWaiting } from '../src/waiting-testing/recorded-waiting.ts';

type Reads = Parameters<typeof waitingCallsOf>[0];

export interface WaitingHost {
  readonly host: WorkflowHost;
  readonly settledAt: ReadonlyMap<string, number>;
  readonly untilSettled: (count: number) => Promise<void>;
  readonly untilWaiting: (runIds: readonly string[]) => Promise<void>;
}

export function childOf(runId: string): string {
  return runId.slice(runId.lastIndexOf('/') + 1).replace('-9b3f-', '-8b3f-');
}

async function until(done: () => Promise<boolean>, everyMs: number): Promise<void> {
  if (!(await done())) {
    await setTimeout(everyMs);
    await until(done, everyMs);
  }
}

function settlingAt(settledAt: Map<string, number>): SettleExecution {
  return (address) =>
    Effect.sync(() => {
      settledAt.set(address.id, Date.now());
      return {
        execution_id: address.id,
        primitive: 'orchestration',
        name: 'measured',
        spec_version: 1,
        status: 'succeeded',
        started_at: '2026-10-07T09:00:00.000Z',
        started_by: 'acme-admin',
      };
    });
}

export async function waitingHost(settings: DatabaseSettings, reads: Reads, signalled: boolean): Promise<WaitingHost> {
  const settledAt = new Map<string, number>();
  const reactions = recordedReactions().options;
  const host = await openWorkflowHost({
    database: settings,
    machine: testMachine,
    perform: (call) => Effect.succeed({ status: 'waiting', child: childOf(call.key.executionId) }),
    settle: settlingAt(settledAt),
    reports: {
      unsettled: () => Effect.void,
      trouble: Effect.logWarning,
      lostConnection: Function.constVoid,
      note: () => Effect.void,
    },
    sweepEveryMs: 1000,
    mostCallsAtOnce: 32,
    reactions: signalled ? reactions : { ...reactions, appended: streamSignalOf() },
    waiting: recordedWaiting().options,
  });
  const allWaiting = async (runIds: readonly string[]) => {
    const waiting = await Promise.all(runIds.map((runId) => Effect.runPromise(waitingCallsOf(reads, runId))));
    return waiting.every((calls) => calls.length === 1);
  };
  return {
    host,
    settledAt,
    untilSettled: (count) => until(() => Promise.resolve(settledAt.size >= count), 5),
    untilWaiting: (runIds) => until(() => allWaiting(runIds), 50),
  };
}
