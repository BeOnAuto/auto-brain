import type { Json, PoolOutcome, ProgramPool, ProgramRequest } from '@beonauto/workflow-engine/dsl';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseComputationDocument } from '../document/document-parsing.ts';
import { campaignPace, campaignRows } from '../testing/campaign-pace.ts';
import { functionOf, poolOf, workerTestTimeoutMs } from '../testing/computation-runs.ts';
import { computationBounds, mostOutputBytes } from './run-bounds.ts';

const example = Result.getOrThrow(parseComputationDocument(campaignPace)).program;

function ran(
  pool: ProgramPool,
  source: string,
  input: Json = null,
  more: Partial<ProgramRequest> = {},
): Promise<PoolOutcome> {
  return pool.run({
    source,
    entry: 'default',
    arguments: [input],
    moment: 0,
    budget: computationBounds.budget,
    memoryBytes: computationBounds.memoryBytes,
    stackBytes: computationBounds.stackBytes,
    deadlineMs: 10_000,
    mostOutputBytes,
    ...more,
  });
}

function inTurn(pool: ProgramPool, sources: readonly string[]): Promise<readonly PoolOutcome[]> {
  return sources.reduce<Promise<readonly PoolOutcome[]>>(
    async (done, source) => [...(await done), await ran(pool, source)],
    Promise.resolve([]),
  );
}

function threadsAlive(): readonly unknown[] {
  const workers: unknown = Reflect.get(process.report.getReport(), 'workers');
  const threads = Array.isArray(workers) ? workers : [];
  return threads.map((worker: unknown): unknown =>
    Reflect.get(new Object(Reflect.get(new Object(worker), 'header')), 'threadId'),
  );
}

const endingBadly = [
  functionOf('throw new Error("raised on purpose");'),
  functionOf('for (;;) {}'),
  functionOf('return "x".repeat(1048576);'),
  functionOf('const kept: string[] = [];\n  for (;;) kept.push("y".repeat(1048576) + kept.length);'),
  functionOf('const down = (depth: number): number => down(depth + 1);\n  return down(0);'),
];

const writingOutside = [
  functionOf('Object.defineProperty(Object.prototype, "polluted", { value: true });\n  return 1;'),
  functionOf('Reflect.set(globalThis, "kept", 1);\n  Array.prototype.push = () => 0;\n  return 1;'),
  functionOf('Math.max = () => 7;\n  return Math.max(1, 2);'),
];

const reading = functionOf(
  'return [Reflect.get({}, "polluted") ?? null, typeof Reflect.get(globalThis, "kept"), [1].push(2), Math.max(1, 2)];',
);

describe('a warm worker after jobs that ended badly', { timeout: workerTestTimeoutMs }, () => {
  it('runs the next program as a fresh worker does: nothing a job did reaches the jobs after it', async () => {
    const warm = poolOf({ workers: 1 });
    const input = campaignRows(1000);

    const badly = await inTurn(warm, endingBadly);
    const first = threadsAlive();
    const writes = await inTurn(warm, writingOutside);
    const seen = await ran(warm, reading);
    const afterAll = await ran(warm, example, input);
    const sameThread = threadsAlive();
    const cold = await ran(poolOf({ workers: 1 }), example, input);

    expect(badly).toMatchObject([
      { ran: 'raised' },
      { ran: 'exhausted', limit: 'work' },
      { ran: 'oversized' },
      { ran: 'exhausted', limit: 'memory' },
      { ran: 'raised', issue: { detail: 'InternalError: stack overflow' } },
    ]);
    expect(writes.map(({ ran: ending }) => ending)).toEqual(['answered', 'answered', 'answered']);
    expect(seen).toMatchObject({ ran: 'answered', output: [null, 'undefined', 2, 2] });
    expect([first.length, sameThread]).toEqual([1, first]);
    expect({ ...afterAll, milliseconds: 0 }).toEqual({ ...cold, milliseconds: 0 });
  });
});
