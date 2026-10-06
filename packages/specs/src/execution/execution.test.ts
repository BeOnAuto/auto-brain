import { describe, expect, expectTypeOf, it } from 'vitest';

import { isFunctionRun, isWorkflowRun, type FunctionRun, type Run, type WorkflowRun } from '../index.ts';

const functionRun: Run = {
  execution_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  primitive: 'inference',
  name: 'review-campaign',
  spec_version: 3,
  status: 'succeeded',
  output: 'The brief meets the criteria.',
  started_at: '2026-09-02T00:00:00.000Z',
  started_by: 'author',
  finished_at: '2026-09-02T00:01:00.000Z',
};

const computationRun: Run = { ...functionRun, primitive: 'computation', output: { total_spend_cents: 17_628 } };

const recallRun: Run = { ...functionRun, primitive: 'recollection', output: [{ verdict: 'approve' }] };

const workflowRun: Run = { ...functionRun, primitive: 'orchestration' };

describe('a run', () => {
  it('is a function run when it ran a reasoning, a computation or a recall function, and a workflow run when it ran a workflow', () => {
    const runs = [functionRun, computationRun, recallRun, workflowRun];

    const functionRuns = runs.filter((run) => isFunctionRun(run));
    const workflowRuns = runs.filter((run) => isWorkflowRun(run));

    expectTypeOf(functionRuns).toEqualTypeOf<FunctionRun[]>();
    expectTypeOf(workflowRuns).toEqualTypeOf<WorkflowRun[]>();
    expect([functionRuns, workflowRuns]).toEqual([[functionRun, computationRun, recallRun], [workflowRun]]);
  });

  it.each(['echo', 'reason', 'workflow', 'interaction', 'prediction', 'recall', 'compute'])(
    'is neither of a custom adapter or a planned function type: %s',
    (primitive) => {
      const run = { ...functionRun, primitive };

      expect([isFunctionRun(run), isWorkflowRun(run)]).toEqual([false, false]);
    },
  );
});
