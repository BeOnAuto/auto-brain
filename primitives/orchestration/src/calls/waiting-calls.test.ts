import type { StartCall } from '@beonauto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { callResultOfEnding, definitionCalls } from './function-calls.ts';
import type { DefinitionRunRequest, DefinitionRunResult } from './function-run.ts';
import { nestedExecutionId } from './nested-execution-id.ts';

const workflowExecution = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = {
  executionId: `acme/alpha/${workflowExecution}`,
  attributes: {
    org: 'acme',
    brain: 'alpha',
    execution_id: workflowExecution,
    spec: { name: 'triage', version: 2 },
    caller: { id: 'acme-admin', org: 'acme', permissions: ['brain:read', 'brain:write'], brains: '*' },
    call_depth: 3,
  },
};

const review: StartCall = {
  kind: 'start_call',
  key: { executionId: run.executionId, reference: '/do/0/review', run: 2 },
  function: 'execute_spec',
  arguments: { primitive: 'orchestration', name: 'review', input: { ticket: 7 } },
  longestMs: 60_000,
};

const ofTheChild = { primitive: 'orchestration', name: 'review', spec_version: 1, by: 'brain:alpha', at: 'now' };

function answering(result: DefinitionRunResult) {
  const asked: DefinitionRunRequest[] = [];
  const perform = definitionCalls((execution) =>
    Effect.sync(() => {
      asked.push(execution);
      return result;
    }),
  );
  return { perform, asked: (): readonly DefinitionRunRequest[] => asked };
}

describe('a workflow call of a workflow', () => {
  it('starts the workflow one call deeper, naming the call it answers, and waits for its run', async () => {
    const { perform, asked } = answering({ status: 'waiting' });

    const answer = await Effect.runPromise(perform(review, run));

    expect(answer).toEqual({ status: 'waiting', child: nestedExecutionId(workflowExecution, '/do/0/review', 2) });
    expect(asked()).toMatchObject([
      {
        primitive: 'orchestration',
        name: 'review',
        callDepth: 4,
        calledBy: { execution_id: workflowExecution, reference: '/do/0/review', run: 2 },
      },
    ]);
  });
});

describe('the ending of a run a step waits for', () => {
  it('answers the step with the output of a run that succeeded, unless the output is larger than a workflow takes', () => {
    expect([
      callResultOfEnding({ type: 'execution_succeeded', output: { done: true }, record: {}, ...ofTheChild }),
      callResultOfEnding({ type: 'execution_succeeded', output: 'x'.repeat(1_048_576), record: {}, ...ofTheChild }),
    ]).toEqual([
      { status: 'succeeded', output: { done: true } },
      { status: 'failed', detail: 'The run returned 1048578 bytes as JSON, more than the 1048576 a workflow takes' },
    ]);
  });

  it('answers the step with the rejection of a run, its kind kept and its issues folded into its detail', () => {
    expect([
      callResultOfEnding({
        type: 'execution_rejected',
        rejection: { reason: 'cancelled', kind: 'deadline', detail: 'Out of time' },
        ...ofTheChild,
      }),
      callResultOfEnding({
        type: 'execution_rejected',
        rejection: {
          reason: 'invalid_input',
          detail: 'Wrong',
          issues: [{ pointer: '/input/ticket', detail: 'Expected a string' }],
        },
        ...ofTheChild,
      }),
    ]).toEqual([
      { status: 'rejected', reason: 'cancelled', kind: 'deadline', detail: 'Out of time' },
      { status: 'rejected', reason: 'invalid_input', detail: 'Wrong (/input/ticket: Expected a string)' },
    ]);
  });

  it('answers the step with a failure that names the incident of a run that broke down, when it has one', () => {
    expect([
      callResultOfEnding({ type: 'execution_failed', incident: 'i-1', ...ofTheChild }),
      callResultOfEnding({ type: 'execution_failed', ...ofTheChild }),
    ]).toEqual([
      { status: 'failed', detail: 'The run failed with incident i-1' },
      { status: 'failed', detail: 'The run failed' },
    ]);
  });
});
