import { allPermissions, type Conflict, type InvalidInput, type Unavailable } from '@beonauto/operations';
import type { Executed, PreparedDefinition, Primitive, RunContext } from '@beonauto/specs';
import { recordingJournal } from '@beonauto/specs/testing';
import { programPool, type PoolSettings, type ProgramPool } from '@beonauto/workflow-engine/dsl';
import { Effect, type Exit, type Schema } from 'effect';
import { afterEach } from 'vitest';

import { makeComputationFunctionAdapter } from '../primitive/computation-function.ts';
import { computationBounds } from '../run/run-bounds.ts';

export const workerTestTimeoutMs = 30_000;

const execution: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  brain: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' },
  spec: { name: 'pace', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
};

export type Execution = Exit.Exit<Executed, InvalidInput | Unavailable | Conflict>;

export interface ComputationRuns {
  readonly primitive: Primitive;
  readonly prepared: (source: string) => PreparedDefinition;
  readonly executing: (source: string, input?: Schema.Json) => Promise<Execution>;
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
    workers: computationBounds.workers,
    heapMegabytes: computationBounds.heapMegabytes,
    environment: measured,
    ...settings,
  });
  pools.push(pool);
  return pool;
}

export function computationWith(pool: ProgramPool = poolOf(), deadlineMs?: number): ComputationRuns {
  const primitive = makeComputationFunctionAdapter({ pool, ...(deadlineMs === undefined ? {} : { deadlineMs }) });
  const prepared = (source: string): PreparedDefinition => Effect.runSync(primitive.prepare(source));
  return {
    primitive,
    prepared,
    executing: (source, input = {}) => Effect.runPromiseExit(prepared(source).execute(input, execution)),
  };
}

export function programDocument(program: string, frontMatter = 'language: jq'): string {
  return `---\n${frontMatter}\n---\n${program}`;
}
