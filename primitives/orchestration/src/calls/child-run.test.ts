import { describe, expect, it } from 'vitest';

import { childRunOf } from './child-run.ts';
import { nestedExecutionId } from './nested-execution-id.ts';

const workflowExecution = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const call = {
  function: 'execute_spec',
  reference: '/do/0/classify',
  run: 2,
  arguments: { primitive: 'inference', name: 'classify', input: {} },
  attributes: { execution_id: workflowExecution },
};

describe('the run a call of a workflow starts', () => {
  it('is the run derived from the workflow, the reference and the run of the call, as its call will start', () => {
    expect(childRunOf(call)).toBe(nestedExecutionId(workflowExecution, '/do/0/classify', 2));
  });

  it('is the run of a workflow the call starts, derived the same way', () => {
    expect(childRunOf({ ...call, arguments: { primitive: 'orchestration', name: 'other' } })).toBe(
      nestedExecutionId(workflowExecution, '/do/0/classify', 2),
    );
  });

  it('is none for arguments the call would refuse, another function, or a run whose attributes name no run', () => {
    expect([
      childRunOf({ ...call, arguments: 'plain' }),
      childRunOf({ ...call, function: 'notify' }),
      childRunOf({ ...call, attributes: {} }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
