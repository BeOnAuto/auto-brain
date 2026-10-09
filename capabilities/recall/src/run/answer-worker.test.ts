import type { ProgramPool, ProgramRequest } from '@beonauto/workflow-engine/dsl';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { recallDocument } from '../testing/campaign-reviews.ts';
import { liveView, poolOf, recallWith, workerTestTimeoutMs } from '../testing/recall-runs.ts';

const succeeded = 'language: jq\nsource:\n  events:\n    - type: run_succeeded';

function recording(pool: ProgramPool): { readonly pool: ProgramPool; readonly requests: ProgramRequest[] } {
  const requests: ProgramRequest[] = [];
  return {
    requests,
    pool: {
      ...pool,
      run: (request, signal) => {
        requests.push(request);
        return pool.run(request, signal);
      },
    },
  };
}

describe('the worker an answer runs in', { timeout: workerTestTimeoutMs }, () => {
  it('is the checked worker for every answer, with the output schema as its context, or null when there is none', async () => {
    const { pool, requests } = recording(poolOf());
    const run = recallWith(pool);
    run.keep(liveView({ spring: [1, 2] }));
    const withoutASchema = recallDocument('.', `${succeeded}\nanswer: '.spring | length'`);
    const withASchema = recallDocument(
      '.',
      `${succeeded}\noutput:\n  schema: {type: integer}\nanswer: '.spring | length'`,
    );

    const answered = [await run.executing(withoutASchema), await run.executing(withASchema)];

    expect(answered).toMatchObject([Exit.succeed({ output: 2 }), Exit.succeed({ output: 2 })]);
    expect(requests.map(({ worker, context }) => ({ worker: worker?.pathname.split('/').at(-1), context }))).toEqual([
      { worker: 'checked-worker.ts', context: null },
      { worker: 'checked-worker.ts', context: { type: 'integer' } },
    ]);
  });
});
