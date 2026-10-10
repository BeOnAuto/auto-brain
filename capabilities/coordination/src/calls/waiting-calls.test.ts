import type { StartCall } from '@beonauto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { callResultOfEnding, definitionCalls } from './function-calls.ts';
import type { DefinitionRunRequest, DefinitionRunResult } from './function-run.ts';
import { nestedRunId } from './nested-run-id.ts';

const workflowRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = {
  runId: `acme/alpha/${workflowRun}`,
  attributes: {
    org: 'acme',
    brain: 'alpha',
    run_id: workflowRun,
    definition: { name: 'triage', version: 2 },
    caller: { id: 'acme-admin', org: 'acme', permissions: ['brain:read', 'brain:write'], brains: '*' },
    call_depth: 3,
  },
};

const review: StartCall = {
  kind: 'start_call',
  key: { runId: run.runId, reference: '/do/0/review', run: 2 },
  function: 'run_definition',
  arguments: { type: 'workflow', name: 'review', input: { ticket: 7 } },
  longestMs: 60_000,
};

const ofTheChild = {
  by: 'brain:alpha',
  at: 'now',
  definitionType: 'workflow',
  definitionName: 'review',
  definitionVersion: 1,
};

function answering(result: DefinitionRunResult) {
  const asked: DefinitionRunRequest[] = [];
  const perform = definitionCalls((request) =>
    Effect.sync(() => {
      asked.push(request);
      return result;
    }),
  );
  return { perform, asked: (): readonly DefinitionRunRequest[] => asked };
}

describe('a workflow call of a workflow', () => {
  it('starts the workflow one call deeper, naming the call it answers, and waits for its run', async () => {
    const { perform, asked } = answering({ status: 'waiting' });

    const answer = await Effect.runPromise(perform(review, run, { version: 2 }));

    expect(answer).toEqual({ status: 'waiting', child: nestedRunId(workflowRun, '/do/0/review', 2) });
    expect(asked()).toMatchObject([
      {
        type: 'workflow',
        name: 'review',
        callDepth: 4,
        calledBy: { run_id: workflowRun, reference: '/do/0/review', run: 2 },
      },
    ]);
  });
});

describe('the ending of a run a step waits for', () => {
  it('answers the step with the output of a run that succeeded, unless the output is larger than a workflow takes', () => {
    expect([
      callResultOfEnding({ type: 'run_succeeded', data: { output: { done: true }, record: {} }, context: ofTheChild }),
      callResultOfEnding({
        type: 'run_succeeded',
        data: { output: 'x'.repeat(1_048_576), record: {} },
        context: ofTheChild,
      }),
    ]).toEqual([
      { status: 'succeeded', output: { done: true } },
      { status: 'failed', detail: 'The run returned 1048578 bytes as JSON, more than the 1048576 a workflow takes' },
    ]);
  });

  it('answers the step with the rejection of a run, its kind kept and its issues folded into its detail', () => {
    expect([
      callResultOfEnding({
        type: 'run_rejected',
        data: { rejection: { reason: 'cancelled', kind: 'deadline', detail: 'Out of time' } },
        context: ofTheChild,
      }),
      callResultOfEnding({
        type: 'run_rejected',
        data: {
          rejection: {
            reason: 'invalid_input',
            detail: 'Wrong',
            issues: [{ pointer: '/input/ticket', detail: 'Expected a string' }],
          },
        },
        context: ofTheChild,
      }),
    ]).toEqual([
      { status: 'rejected', reason: 'cancelled', kind: 'deadline', detail: 'Out of time' },
      { status: 'rejected', reason: 'invalid_input', detail: 'Wrong (/input/ticket: Expected a string)' },
    ]);
  });

  it('answers the step with a failure that names the incident of a run that broke down, when it has one', () => {
    expect([
      callResultOfEnding({ type: 'run_failed', data: { incident: 'i-1' }, context: ofTheChild }),
      callResultOfEnding({ type: 'run_failed', data: {}, context: ofTheChild }),
    ]).toEqual([
      { status: 'failed', detail: 'The run failed with incident i-1' },
      { status: 'failed', detail: 'The run failed' },
    ]);
  });
});
