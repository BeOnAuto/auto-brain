import { describe, expect, it } from 'vitest';

import { specExecutionResultOf } from '../index.ts';
import { definitionRunResultOf } from './function-results.ts';

describe('the result of executing a spec through the operations', () => {
  it('retains the exported result adapter as the same implementation', () => {
    expect(specExecutionResultOf).toBe(definitionRunResultOf);
  });
  it('is the output of the execution that succeeded', () => {
    expect(definitionRunResultOf({ status: 'succeeded', output: { status: 'succeeded', output: { a: 1 } } })).toEqual({
      status: 'succeeded',
      output: { a: 1 },
    });
    expect(definitionRunResultOf({ status: 'succeeded', output: { status: 'succeeded' } })).toEqual({
      status: 'succeeded',
      output: null,
    });
  });

  it('is a failure for an execution that finishes later, which a workflow cannot wait for yet', () => {
    expect(definitionRunResultOf({ status: 'succeeded', output: { status: 'started' } })).toEqual({
      status: 'failed',
      detail: 'The execution finishes later, and a workflow cannot wait for it in this version',
    });
  });

  it('is the rejection, with its issues when it has some', () => {
    expect(definitionRunResultOf({ status: 'rejected', reason: 'forbidden', detail: 'No' })).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'No',
    });
    expect(
      definitionRunResultOf({
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'Wrong',
        issues: [{ detail: 'Expected a string', pointer: '/input' }],
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'Wrong',
      issues: [{ detail: 'Expected a string', pointer: '/input' }],
    });
  });

  it('is a failure that names the incident of a call that failed', () => {
    expect(definitionRunResultOf({ status: 'failed', incident: 'inc-1' })).toEqual({
      status: 'failed',
      detail: 'The execution failed with incident inc-1',
    });
  });
});

describe('the rejection of executing a spec that names its kind and because', () => {
  it('is the rejection with its kind and because, which a workflow reads in the error it catches', () => {
    expect(
      specExecutionResultOf({
        status: 'rejected',
        reason: 'unavailable',
        detail: 'A tool server kept failing',
        kind: 'tools_unfinished',
        because: 'server_failed',
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'A tool server kept failing',
      kind: 'tools_unfinished',
      because: 'server_failed',
    });
  });
});
