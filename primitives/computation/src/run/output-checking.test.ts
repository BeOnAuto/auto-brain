import type { ProgramPool, ProgramRequest } from '@beonauto/workflow-engine/dsl';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignPace, campaignRows } from '../testing/campaign-pace.ts';
import { computationWith, poolOf, programDocument, workerTestTimeoutMs } from '../testing/computation-runs.ts';
import { outputCheckOf } from './output-check.ts';

function recording(pool: ProgramPool): { readonly pool: ProgramPool; readonly requests: ProgramRequest[] } {
  const requests: ProgramRequest[] = [];
  return {
    requests,
    pool: {
      workers: pool.workers,
      heapMegabytes: pool.heapMegabytes,
      close: pool.close,
      run: (request, signal) => {
        requests.push(request);
        return pool.run(request, signal);
      },
    },
  };
}

describe('the check of an output against the output schema', { timeout: workerTestTimeoutMs }, () => {
  it('runs in the worker that runs the program, under its deadline, never on the thread that asked', async () => {
    const { pool, requests } = recording(poolOf());
    const run = computationWith(pool);

    expect(await run.executing(campaignPace, campaignRows(10))).toMatchObject(Exit.succeed({}));
    expect(await run.executing(programDocument('.'), 1)).toMatchObject(Exit.succeed({ output: 1 }));
    expect(requests.map(({ worker, context }) => ({ worker: worker?.pathname.split('/').at(-1), context }))).toEqual([
      { worker: 'output-worker.ts', context: run.prepared(campaignPace).summary.outputSchema },
      { worker: undefined, context: undefined },
    ]);
  });

  it('names at most three issues of the output', () => {
    const check = outputCheckOf({ type: 'array', items: { type: 'string' } });

    expect(check([1, 2, 3, 4])).toEqual(['/0: Expected string', '/1: Expected string', '/2: Expected string']);
    expect(check('x')).toEqual(['the output: Expected array']);
    expect(check(['x'])).toEqual([]);
  });

  it('refuses every output when the schema it is given does not compile, naming why', () => {
    expect(outputCheckOf('not a schema')(1)).toEqual(['the output: A schema is a JSON object']);
  });
});
