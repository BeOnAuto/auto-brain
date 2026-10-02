import { describe, expect, it } from 'vitest';

import { interpret, workflow } from '../testing/workflows.ts';
import type { SpecCallResult } from './host.ts';
import type { WorkflowEnding } from './settlement.ts';

const calling = workflow(`
do:
  - lookup:
      try:
        - fetch:
            call: execute_spec
            with: { primitive: inference, name: lookup, input: {} }
      catch:
        as: failure
        do:
          - report:
              set: '\${ $failure }'
`);

async function caughtFor(respond: () => SpecCallResult | Promise<SpecCallResult>): Promise<WorkflowEnding> {
  return (await interpret(calling, { respond })).ending;
}

const types = 'https://open-workflow-specification.org/spec/1.0.0/errors';

function unreachable(): Promise<SpecCallResult> {
  return Promise.reject(new Error('Activity task failed', { cause: new Error('the worker is gone') }));
}

describe('a rejected execution', () => {
  it.each([
    ['invalid_input', 'validation', 400],
    ['forbidden', 'authorization', 403],
    ['not_found', 'configuration', 404],
    ['conflict', 'runtime', 409],
    ['unavailable', 'communication', 503],
    ['unheard_of', 'runtime', 500],
  ])('with %s is a %s error of status %d the document can catch', async (reason, kind, status) => {
    expect(await caughtFor(() => ({ status: 'rejected', reason, detail: 'The model is busy' }))).toEqual({
      kind: 'completed',
      output: {
        type: `${types}/${kind}`,
        status,
        instance: '/do/0/lookup/try/0/fetch',
        title: `The inference spec lookup rejected the execution with ${reason}`,
        detail: 'The model is busy',
      },
    });
  });
});

describe('a failed execution', () => {
  it('is a runtime error', async () => {
    expect(await caughtFor(() => ({ status: 'failed', detail: 'It failed with incident 7' }))).toEqual({
      kind: 'completed',
      output: {
        type: `${types}/runtime`,
        status: 500,
        instance: '/do/0/lookup/try/0/fetch',
        title: 'The inference spec lookup failed',
        detail: 'It failed with incident 7',
      },
    });
  });

  it('is a communication error when the execution could not be reached, with the chain of causes', async () => {
    expect(await caughtFor(unreachable)).toEqual({
      kind: 'completed',
      output: {
        type: `${types}/communication`,
        status: 503,
        instance: '/do/0/lookup/try/0/fetch',
        title: 'execute_spec could not reach the inference spec lookup',
        detail: 'Error: Activity task failed: Error: the worker is gone',
      },
    });
  });
});
