import type { ProgramPool, ProgramRequest } from '@beonauto/workflow-engine/dsl';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignPace, campaignRows } from '../testing/campaign-pace.ts';
import {
  computationWith,
  functionOf,
  poolOf,
  programDocument,
  workerTestTimeoutMs,
} from '../testing/computation-runs.ts';

function recording(pool: ProgramPool): { readonly pool: ProgramPool; readonly requests: ProgramRequest[] } {
  const requests: ProgramRequest[] = [];
  return {
    requests,
    pool: {
      workers: pool.workers,
      heapMegabytes: pool.heapMegabytes,
      fold: pool.fold,
      check: pool.check,
      close: pool.close,
      run: (request, signal) => {
        requests.push(request);
        return pool.run(request, signal);
      },
    },
  };
}

const outputSchema = 'language: typescript\noutput:\n  schema: {type: array, items: {type: string}}';

describe('the check of an output against the output schema', { timeout: workerTestTimeoutMs }, () => {
  it('runs in the checked worker that runs the program, under its deadline, never on the thread that asked, the one module every run names', async () => {
    const { pool, requests } = recording(poolOf());
    const run = computationWith(pool);

    expect(await run.running(campaignPace, campaignRows(10))).toMatchObject(Exit.succeed({}));
    expect(await run.running(programDocument(functionOf('return input;')), 1)).toMatchObject(
      Exit.succeed({ output: 1 }),
    );
    expect(requests.map(({ worker, context }) => ({ worker: worker?.pathname.split('/').at(-1), context }))).toEqual([
      { worker: 'checked-worker.ts', context: run.prepared(campaignPace).summary.outputSchema },
      { worker: 'checked-worker.ts', context: null },
    ]);
  });

  it('refuses an output the schema refuses, naming at most three of its issues in the one wording of them', async () => {
    const run = computationWith();

    expect(await run.running(programDocument(functionOf('return [1, 2, 3, 4];'), outputSchema))).toMatchObject(
      Exit.fail({
        kind: 'unworkable',
        detail:
          "The program's output does not match the output schema: /0: Expected string; /1: Expected string; /2: Expected string",
      }),
    );
  });
});
