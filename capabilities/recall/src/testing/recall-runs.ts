import type { CapabilityAnswer, PreparedDefinition, Capability, RunContext } from '@beonauto/definitions';
import { noLongestRuns, recordingJournal } from '@beonauto/definitions/testing';
import { allPermissions, type Conflict, type InvalidInput, type Unavailable } from '@beonauto/operations';
import { programPool, type PoolSettings, type ProgramPool } from '@beonauto/workflow-engine/dsl';
import type { KeptView } from '@beonauto/workflow-host';
import { Effect, type Exit, type Schema } from 'effect';
import { afterEach } from 'vitest';

import { makeRecallFunctionAdapter } from '../capability/recall-function.ts';
import { recallBounds } from '../run/recall-bounds.ts';
import { keptViews, type KeptViews } from './kept-views.ts';

export const workerTestTimeoutMs = 30_000;

const reviewsRun: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  brain: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' },
  definition: { name: 'reviews', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
  callDepth: 0,
  longestRunOf: noLongestRuns,
};

type Run = Exit.Exit<CapabilityAnswer, InvalidInput | Unavailable | Conflict>;

export interface RecallRuns extends KeptViews {
  readonly capability: Capability;
  readonly prepared: (source: string) => PreparedDefinition;
  readonly executing: (source: string, input?: Schema.Json) => Promise<Run>;
}

const pools: ProgramPool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

const measured: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(process.env).flatMap(([key, value]: readonly [string, string | undefined]) =>
    key === 'NODE_V8_COVERAGE' && value !== undefined ? [[key, value]] : [],
  ),
);

export function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({
    workers: 2,
    heapMegabytes: recallBounds.heapMegabytes,
    environment: measured,
    ...settings,
  });
  pools.push(pool);
  return pool;
}

export function liveView(view: Schema.Json, more: Partial<KeptView> = {}): KeptView {
  return {
    name: 'reviews',
    version: 1,
    phase: 'live',
    view,
    checkpoint: 'YnJhaW4vYWNtZS9hbHBoYS8sNDI',
    checkpointAt: '2026-10-06T10:00:05.000Z',
    lastEvent: { id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1b', time: '2026-10-06T10:00:04.000Z' },
    folded: 5,
    ...more,
  };
}

export function recallWith(pool: ProgramPool = poolOf(), deadlineMs?: number): RecallRuns {
  const views = keptViews();
  const capability = makeRecallFunctionAdapter({
    pool,
    views: views.views,
    ...(deadlineMs === undefined ? {} : { deadlineMs }),
  });
  const prepared = (source: string): PreparedDefinition => Effect.runSync(capability.prepare(source));
  return {
    ...views,
    capability,
    prepared,
    executing: (source, input = {}) => Effect.runPromiseExit(prepared(source).run(input, reviewsRun)),
  };
}
