import type { CapabilityAnswer, PreparedDefinition, Capability, RunContext } from '@beonauto/definitions';
import { noLongestRuns, recordingJournal } from '@beonauto/definitions/testing';
import { allPermissions, type Conflict, type InvalidInput, type Unavailable } from '@beonauto/operations';
import { programPool, type PoolSettings, type ProgramPool } from '@beonauto/workflow-engine/dsl';
import { Effect, type Exit, type Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach } from 'vitest';

import {
  makeComputationFunctionAdapter,
  type ComputationFunctionAdapterOptions,
} from '../capability/computation-function.ts';
import { computationBounds } from '../run/run-bounds.ts';

export const workerTestTimeoutMs = 30_000;

const checkDeadlineMs = 20_000;

const run: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  brain: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' },
  definition: { name: 'pace', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
  callDepth: 0,
  longestRunOf: noLongestRuns,
};

export type Run = Exit.Exit<CapabilityAnswer, InvalidInput | Unavailable | Conflict>;

export interface ComputationRuns {
  readonly capability: Capability;
  readonly prepared: (source: string) => PreparedDefinition;
  readonly running: (source: string, input?: Schema.Json) => Promise<Run>;
  readonly runningAt: (moment: number, source: string, input?: Schema.Json) => Promise<Run>;
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
  return { ...pool, check: (request, signal) => pool.check({ ...request, deadlineMs: checkDeadlineMs }, signal) };
}

export type RunBounds = Omit<ComputationFunctionAdapterOptions, 'pool'>;

export function computationWith(pool: ProgramPool = poolOf(), bounds: RunBounds = {}): ComputationRuns {
  const capability = makeComputationFunctionAdapter({ pool, ...bounds });
  const prepared = (source: string): PreparedDefinition => Effect.runSync(capability.prepare(source));
  return {
    capability,
    prepared,
    running: (source, input = {}) => Effect.runPromiseExit(prepared(source).run(input, run)),
    runningAt: (moment, source, input = {}) =>
      Effect.runPromiseExit(
        TestClock.setTime(moment).pipe(
          Effect.andThen(prepared(source).run(input, run)),
          Effect.provide(TestClock.layer()),
        ),
      ),
  };
}

export function programDocument(program: string, frontMatter = 'language: typescript'): string {
  return `---\n${frontMatter}\n---\n${program}`;
}

export function functionOf(body: string): string {
  return `export default function (input: any): any {\n  ${body}\n}`;
}
