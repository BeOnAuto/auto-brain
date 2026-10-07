import type { Json, PoolOutcome, ProgramLimits, ProgramPool } from '@beonauto/workflow-engine/dsl';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseComputationDocument } from '../document/document-parsing.ts';
import { computationDialect } from '../document/program-dialect.ts';
import { campaignPace, campaignRows } from '../testing/campaign-pace.ts';
import { poolOf, workerTestTimeoutMs } from '../testing/computation-runs.ts';
import { computationLimits, mostOutputBytes } from './run-bounds.ts';

const example = Result.getOrThrow(parseComputationDocument(campaignPace)).program;

const withoutADepth: ProgramLimits = { ...computationLimits, mostDepth: Number.POSITIVE_INFINITY };

function ran(pool: ProgramPool, source: string, input: Json = null, limits = computationLimits): Promise<PoolOutcome> {
  return pool.run({ source, input, dialect: computationDialect, limits, deadlineMs: 10_000, mostOutputBytes });
}

function threadsAlive(): readonly unknown[] {
  const workers: unknown = Reflect.get(process.report.getReport(), 'workers');
  const threads = Array.isArray(workers) ? workers : [];
  return threads.map((worker: unknown): unknown =>
    Reflect.get(new Object(Reflect.get(new Object(worker), 'header')), 'threadId'),
  );
}

describe('a warm worker after jobs that ended badly', { timeout: workerTestTimeoutMs }, () => {
  it('runs the next program as a fresh worker does: nothing a job did reaches the jobs after it', async () => {
    const warm = poolOf({ workers: 1 });
    const input = campaignRows(1000);

    const badly = [
      await ran(warm, 'error("raised on purpose")'),
      await ran(warm, '"x" * 100000000'),
      await ran(warm, '"x" * 1048576'),
      await ran(warm, 'def g: if . == 0 then 0 else (. - 1 | g) end; 1000000 | g', null, withoutADepth),
    ];
    const first = threadsAlive();
    const writes = [
      await ran(warm, '{} | .["__proto__"]["polluted"] = true'),
      await ran(warm, '{} | setpath(["__proto__", "polluted"]; true)'),
      await ran(warm, '{"__proto__": {"polluted": true}}'),
    ];
    const polluted = await ran(warm, '{} | has("polluted")');
    const afterAll = await ran(warm, example, input);
    const sameThread = threadsAlive();
    const cold = await ran(poolOf({ workers: 1 }), example, input);

    expect(badly).toMatchObject([
      { ran: 'raised' },
      { ran: 'exhausted', limit: 'work' },
      { ran: 'oversized' },
      { ran: 'exhausted', limit: 'stack' },
    ]);
    expect(writes.map(({ ran: ending }) => ending)).toEqual(['unfit', 'unfit', 'answered']);
    expect(polluted).toMatchObject({ ran: 'answered', output: false });
    expect([first.length, sameThread]).toEqual([1, first]);
    expect({ ...afterAll, milliseconds: 0 }).toEqual({ ...cold, milliseconds: 0 });
  });
});
