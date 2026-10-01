import { describe, expect, it } from 'vitest';

import { runOf, workflow } from '../testing/workflows.ts';
import { readWorkflowRun } from './workflow-run.ts';

const run = runOf(workflow('do: []'), { name: 'Ada' });

describe('the run a workflow is started with', () => {
  it('is read when it names a document, an input, an execution and a caller', () => {
    expect(readWorkflowRun(JSON.parse(JSON.stringify(run)))).toEqual(run);
    expect(readWorkflowRun({ ...run, caller: { ...run.caller, brains: ['alpha'] } })).toMatchObject({
      caller: { brains: ['alpha'] },
    });
  });

  const malformed: readonly (readonly [string, unknown])[] = [
    ['not an object', 'run'],
    ['no document', { ...run, document: 'none' }],
    ['no input', { document: run.document, execution: run.execution, caller: run.caller }],
    ['an execution of no spec', { ...run, execution: { ...run.execution, spec: 'test-flow' } }],
    ['an execution of a spec of no version', { ...run, execution: { ...run.execution, spec: { name: 'a' } } }],
    ['an execution of no brain', { ...run, execution: { ...run.execution, brain: 7 } }],
    ['an execution of no id', { ...run, execution: { ...run.execution, id: null } }],
    ['no execution', { ...run, execution: 'e' }],
    ['a caller of no permissions', { ...run, caller: { ...run.caller, permissions: 'all' } }],
    ['a caller of an unknown permission', { ...run, caller: { ...run.caller, permissions: ['brain:own'] } }],
    ['a caller of odd brains', { ...run, caller: { ...run.caller, brains: [1] } }],
    ['a caller of no org', { ...run, caller: { ...run.caller, org: 1 } }],
    ['no caller', { ...run, caller: 'acme-admin' }],
  ];

  it.each(malformed)('is refused when it has %s', (_case, value) => {
    expect(readWorkflowRun(value)).toBeUndefined();
  });
});
