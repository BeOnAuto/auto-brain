import { setTimeout } from 'node:timers/promises';

import { streamSignalOf } from '@beonauto/ledger';
import { messageIdOf } from '@beonauto/operations';
import { testMachine } from '@beonauto/workflow-engine/testing';
import { Effect, Function } from 'effect';

import type { DatabaseSettings } from '../src/database/host-databases.ts';
import { openHostDatabase } from '../src/database/host-databases.ts';
import { openWorkflowHost } from '../src/host/workflow-host.ts';
import { alpha, brainCreated, eventTrigger, published, specRecorded } from '../src/reaction-testing/brain-writes.ts';
import { recordedReactions } from '../src/reaction-testing/recorded-reactions.ts';
import { recordedWaiting } from '../src/waiting-testing/recorded-waiting.ts';

export interface ReactionLatency {
  readonly events: number;
  readonly workflows: number;
  readonly p50: number;
  readonly p99: number;
  readonly most: number;
}

export interface LatencyCase {
  readonly workflows: number;
  readonly events: number;
  readonly signalled: boolean;
}

const quiet = {
  unsettled: () => Effect.void,
  trouble: Effect.logWarning,
  lostConnection: Function.constVoid,
  note: () => Effect.void,
};

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function typeOf(index: number, workflows: number): string {
  return `com.measure.t${index % workflows}`;
}

async function untilStarted(count: () => number, most: number): Promise<void> {
  if (count() < most) {
    await setTimeout(5);
    await untilStarted(count, most);
  }
}

async function publishedInTurn(
  store: Parameters<typeof published>[0],
  { events, workflows }: LatencyCase,
  publishedAt: Map<string, number>,
): Promise<void> {
  await Array.from({ length: events }, (_, index) => index).reduce<Promise<void>>(
    (before, index) =>
      before
        .then(() => published(store, { id: `e${index}`, type: typeOf(index, workflows) }))
        .then(() => {
          publishedAt.set(messageIdOf(`${alpha}events/e${index}`, 1), Date.now());
          return index;
        })
        .then(Function.constVoid),
    Promise.resolve(),
  );
}

export async function reactionLatencyOn(database: DatabaseSettings, measured: LatencyCase): Promise<ReactionLatency> {
  const startedAt = new Map<string, number>();
  const publishedAt = new Map<string, number>();
  const reactions = recordedReactions();
  const opened = await openHostDatabase(database, Function.constVoid);
  await brainCreated(opened.store, 'alpha');
  const host = await openWorkflowHost({
    database,
    machine: testMachine,
    perform: () => Effect.succeed({ status: 'succeeded', output: null }),
    settle: () => Effect.die(new Error('The measured runs settle nothing')),
    reports: quiet,
    sweepEveryMs: 1000,
    mostCallsAtOnce: 32,
    reactions: {
      ...reactions.options,
      start: (start) =>
        Effect.sync(() => {
          startedAt.set(start.cause ?? '', Date.now());
        }),
      ...(measured.signalled ? {} : { appended: streamSignalOf() }),
    },
    waiting: recordedWaiting().options,
  });
  await Array.from({ length: measured.workflows }, (_, index) => index).reduce<Promise<void>>(
    (before, index) =>
      before.then(() =>
        specRecorded(opened.store, {
          name: `w${index}`,
          version: 1,
          trigger: eventTrigger({ type: typeOf(index, measured.workflows) }),
        }),
      ),
    Promise.resolve(),
  );
  await publishedInTurn(opened.store, measured, publishedAt);
  await untilStarted(() => startedAt.size, measured.events);
  await host.stop();
  await opened.close();
  const late = [...startedAt]
    .map(([cause, at]: readonly [string, number]) => at - (publishedAt.get(cause) ?? at))
    .toSorted((a, b) => a - b);
  return {
    events: measured.events,
    workflows: measured.workflows,
    p50: percentile(late, 0.5),
    p99: percentile(late, 0.99),
    most: late.at(-1) ?? 0,
  };
}
