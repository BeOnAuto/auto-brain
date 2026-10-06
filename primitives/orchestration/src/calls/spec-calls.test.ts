import type { StartCall } from '@beonauto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeCaller } from '../testing/workflows.ts';
import { nestedExecutionId } from './nested-execution-id.ts';
import { specCalls } from './spec-calls.ts';
import type { SpecExecution, SpecExecutionResult } from './spec-execution.ts';

const workflowExecution = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = {
  executionId: `acme/alpha/${workflowExecution}`,
  attributes: {
    org: 'acme',
    brain: 'alpha',
    execution_id: workflowExecution,
    spec: { name: 'triage', version: 2 },
    caller: { id: 'acme-admin', org: 'acme', permissions: ['brain:read', 'brain:write'], brains: '*' },
  },
};

function callWith(arguments_: StartCall['arguments']): StartCall {
  return {
    kind: 'start_call',
    key: { executionId: run.executionId, reference: '/do/0/classify', run: 1 },
    function: 'execute_spec',
    arguments: arguments_,
    longestMs: 60_000,
  };
}

const classify = callWith({ primitive: 'inference', name: 'classify', input: { ticket: 7 } });

function answering(result: SpecExecutionResult) {
  const asked: SpecExecution[] = [];
  const perform = specCalls((execution) =>
    Effect.sync(() => {
      asked.push(execution);
      return result;
    }),
  );
  return { perform, asked };
}

describe('a call of a workflow to a spec of its brain', () => {
  it('executes the spec for the caller who started the run, under an id derived from the run, the task and its run', async () => {
    const { perform, asked } = answering({ status: 'succeeded', output: { urgency: 'high' } });

    const result = await Effect.runPromise(perform(classify, run));

    expect(result).toEqual({ status: 'succeeded', output: { urgency: 'high' } });
    expect(asked).toEqual([
      {
        org: 'acme',
        brain: 'alpha',
        caller: acmeCaller,
        primitive: 'inference',
        name: 'classify',
        input: { ticket: 7 },
        executionId: nestedExecutionId(workflowExecution, '/do/0/classify', 1),
      },
    ]);
  });

  it('is rejected as invalid arguments, executing nothing, when they do not name a spec it may execute', async () => {
    const { perform, asked } = answering({ status: 'succeeded', output: null });

    const results = await Effect.runPromise(
      Effect.all([
        perform(callWith({ primitive: 'orchestration', name: 'other' }), run),
        perform(callWith('classify'), run),
      ]),
    );

    expect(results).toEqual([
      {
        status: 'rejected',
        reason: 'invalid_arguments',
        detail: 'A workflow cannot execute another workflow in this version',
      },
      {
        status: 'rejected',
        reason: 'invalid_arguments',
        detail: 'execute_spec takes with: { primitive, name, input }',
      },
    ]);
    expect(asked).toEqual([]);
  });
});

describe('a call of a workflow whose run names no caller', () => {
  it('fails for a run that names no brain or caller', async () => {
    const { perform } = answering({ status: 'succeeded', output: null });

    expect(await Effect.runPromise(perform(classify, { ...run, attributes: {} }))).toEqual({
      status: 'failed',
      detail: 'The run names no brain and no caller to execute a spec for',
    });
  });
});

describe('the answer of a spec a workflow called', () => {
  it('carries a rejection with its issues folded into its detail', async () => {
    const { perform } = answering({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'Wrong',
      issues: [{ detail: 'Expected a string', pointer: '/input/ticket' }],
    });

    expect(await Effect.runPromise(perform(classify, run))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'Wrong (/input/ticket: Expected a string)',
    });
  });

  it('carries a failure, and fails an output larger than a workflow takes', async () => {
    const failed = answering({ status: 'failed', detail: 'The execution failed with incident i-1' });
    const large = answering({ status: 'succeeded', output: 'x'.repeat(1_048_576) });

    expect(await Effect.runPromise(failed.perform(classify, run))).toEqual({
      status: 'failed',
      detail: 'The execution failed with incident i-1',
    });
    expect(await Effect.runPromise(large.perform(classify, run))).toEqual({
      status: 'failed',
      detail: 'The spec answered with 1048578 bytes as JSON, more than the 1048576 a workflow takes',
    });
  });

  it('carries a rejection without issues as it is', async () => {
    const { perform } = answering({ status: 'rejected', reason: 'unavailable', detail: 'Busy' });

    expect(await Effect.runPromise(perform(classify, run))).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'Busy',
    });
  });
});

describe('a call whose spec is rejected with a kind and because', () => {
  it('carries the kind and because of a rejection', async () => {
    const { perform } = answering({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'No tool server of that name',
      kind: 'tool_not_offered',
      because: 'mcp_server_not_configured',
    });

    expect(await Effect.runPromise(perform(classify, run))).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'No tool server of that name',
      kind: 'tool_not_offered',
      because: 'mcp_server_not_configured',
    });
  });
});
