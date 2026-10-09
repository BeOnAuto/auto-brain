import { describe, expect, expectTypeOf, it } from 'vitest';

import { isFunctionRun, isWorkflowRun, type FunctionRun, type Run, type WorkflowRun } from '../index.ts';

const functionRun: Run = {
  run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  type: 'reasoning',
  name: 'review-campaign',
  definition_version: 3,
  status: 'succeeded',
  output: 'The brief meets the criteria.',
  started_at: '2026-09-02T00:00:00.000Z',
  started_by: 'author',
  finished_at: '2026-09-02T00:01:00.000Z',
};

const computationRun: Run = { ...functionRun, type: 'computation', output: { total_spend_cents: 17_628 } };

const recallRun: Run = { ...functionRun, type: 'recall', output: [{ verdict: 'approve' }] };

const interactionRun: Run = { ...functionRun, type: 'interaction', output: { choice: 'approve' } };

const workflowRun: Run = { ...functionRun, type: 'workflow' };

describe('a run', () => {
  it('is a function run when it ran a reasoning, an interaction, a computation or a recall function, and a workflow run when it ran a workflow', () => {
    const runs = [functionRun, interactionRun, computationRun, recallRun, workflowRun];

    const functionRuns = runs.filter((run) => isFunctionRun(run));
    const workflowRuns = runs.filter((run) => isWorkflowRun(run));

    expectTypeOf(functionRuns).toEqualTypeOf<FunctionRun[]>();
    expectTypeOf(workflowRuns).toEqualTypeOf<WorkflowRun[]>();
    expect([functionRuns, workflowRuns]).toEqual([
      [functionRun, interactionRun, computationRun, recallRun],
      [workflowRun],
    ]);
  });

  it.each(['echo', 'reason', 'interact', 'prediction', 'compute'])(
    'is neither of a custom adapter or a planned function type: %s',
    (type) => {
      const run = { ...functionRun, type };

      expect([isFunctionRun(run), isWorkflowRun(run)]).toEqual([false, false]);
    },
  );
});
