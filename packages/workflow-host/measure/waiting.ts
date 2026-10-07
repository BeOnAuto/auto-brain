import { Effect, Function, type Schema } from 'effect';

import { openHostDatabase, type DatabaseSettings } from '../src/database/host-databases.ts';
import { alpha, at, brainCreated, recorded } from '../src/reaction-testing/brain-writes.ts';
import { header, runAt, startOf } from './measured-host.ts';
import { childOf, waitingHost, type WaitingHost } from './waiting-host.ts';

export interface WaitingLatency {
  readonly runs: number;
  readonly p50: number;
  readonly p99: number;
  readonly most: number;
}

export interface WaitingCase {
  readonly runs: number;
  readonly signalled: boolean;
  readonly oneAtATime: boolean;
}

type Store = Awaited<ReturnType<typeof openHostDatabase>>['store'];

const calling: Schema.JsonObject = { document: header, do: [{ ask: { call: 'notify', with: { to: 'ada' } } }] };

const pausing: Schema.JsonObject = { document: header, do: [{ pause: { wait: 'PT1H' } }] };

const ofTheRun = { primitive: 'orchestration', name: 'measured', spec_version: 1, at };

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function inTurn(count: number, each: (index: number) => Promise<unknown>): Promise<void> {
  return Array.from({ length: count }, (_, index) => index).reduce<Promise<void>>(
    (before, index) => before.then(() => each(index)).then(Function.constVoid),
    Promise.resolve(),
  );
}

function latencyOf(recordedAt: ReadonlyMap<string, number>, { settledAt }: WaitingHost): WaitingLatency {
  const late = [...recordedAt]
    .map(([executionId, when]: readonly [string, number]) => (settledAt.get(executionId) ?? when) - when)
    .toSorted((a, b) => a - b);
  return { runs: late.length, p50: percentile(late, 0.5), p99: percentile(late, 0.99), most: late.at(-1) ?? 0 };
}

async function measuredOn(
  database: DatabaseSettings,
  { runs, signalled, oneAtATime }: WaitingCase,
  document: Schema.JsonObject,
  record: (store: Store, executionId: string) => Promise<void>,
): Promise<WaitingLatency> {
  const opened = await openHostDatabase(database, Function.constVoid);
  await brainCreated(opened.store, 'alpha');
  const waiting = await waitingHost(database, opened, signalled);
  await inTurn(runs, (index) => Effect.runPromise(waiting.host.start(runAt(index), startOf(document))));
  if (document === calling) {
    await waiting.untilWaiting(Array.from({ length: runs }, (_, index) => `acme/alpha/${runAt(index).executionId}`));
  }
  const recordedAt = new Map<string, number>();
  await inTurn(runs, async (index) => {
    const { executionId } = runAt(index);
    await record(opened.store, executionId);
    recordedAt.set(executionId, Date.now());
    await waiting.untilSettled(oneAtATime ? index + 1 : 0);
  });
  await waiting.untilSettled(runs);
  await waiting.host.stop();
  await opened.close();
  return latencyOf(recordedAt, waiting);
}

export function childEndingLatencyOn(database: DatabaseSettings, measured: WaitingCase): Promise<WaitingLatency> {
  return measuredOn(database, measured, calling, (store, executionId) =>
    recorded(store, `${alpha}executions/${childOf(executionId)}`, {
      type: 'execution_succeeded',
      output: 'done',
      record: {},
      by: 'brain:alpha',
      called_by: { execution_id: executionId, reference: '/do/0/ask', run: 1 },
      ...ofTheRun,
    }),
  );
}

export function cancelLatencyOn(database: DatabaseSettings, measured: WaitingCase): Promise<WaitingLatency> {
  return measuredOn(database, measured, pausing, (store, executionId) =>
    recorded(store, `${alpha}executions/${executionId}`, {
      type: 'execution_cancel_requested',
      kind: 'requested',
      reason: 'Measured',
      by: 'acme-admin',
      ...ofTheRun,
    }),
  );
}
