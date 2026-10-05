import { describe, expect, it } from 'vitest';

import { fakeHost } from '../testing/fake-host.ts';
import { acmeCaller, executionId, runOf, workflow } from '../testing/workflows.ts';
import { startWorkflow } from './interpreter.ts';
import { readWorkflowRun } from './workflow-run.ts';

const run = runOf(workflow('do: []'), { name: 'Ada' });

describe('the run the tests start a workflow with', () => {
  it('carries the execution and the caller of the run', () => {
    expect(run).toMatchObject({ caller: acmeCaller, execution: { id: executionId } });
  });
});

describe('the run a workflow is started with', () => {
  it('is read when it names a document, an input, an execution and a caller', () => {
    expect(readWorkflowRun(JSON.parse(JSON.stringify(run)))).toEqual(run);
    expect(readWorkflowRun({ ...run, caller: { ...run.caller, brains: ['alpha'] } })).toMatchObject({
      caller: { brains: ['alpha'] },
    });
  });

  it('runs for at most 30 days when it names no longest duration', () => {
    const { mostDuration: _set, ...unlimited } = run;

    expect(readWorkflowRun(unlimited)).toMatchObject({ mostDuration: 2_592_000_000 });
    expect(readWorkflowRun({ ...run, mostDuration: 7_200_000 })).toMatchObject({ mostDuration: 7_200_000 });
  });

  it('lets a nested execution run for 10 minutes when it names no longest one', () => {
    const { longestNestedExecutionMs: _set, ...unbounded } = run;

    expect(readWorkflowRun(unbounded)).toMatchObject({ longestNestedExecutionMs: 600_000 });
    expect(readWorkflowRun({ ...run, longestNestedExecutionMs: 1_660_000 })).toMatchObject({
      longestNestedExecutionMs: 1_660_000,
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
    ['a longest duration that is not a number', { ...run, mostDuration: 'P30D' }],
    ['a longest duration that is not positive', { ...run, mostDuration: 0 }],
    ['a longest nested execution that is not positive', { ...run, longestNestedExecutionMs: -1 }],
    ['a longest nested execution that is not a number', { ...run, longestNestedExecutionMs: '28 minutes' }],
  ];

  it.each(malformed)('is rejected when it has %s', (_case, value) => {
    expect(readWorkflowRun(value)).toBeUndefined();
  });
});

describe('a workflow run that cannot be read', () => {
  it('fails without settling', async () => {
    const fake = fakeHost();
    const start = startWorkflow({ document: 'nothing' }, fake.host);
    start.deliver({ id: 'e1', type: 'ignored' });

    expect(await fake.drive(() => start.ending)).toEqual({
      kind: 'faulted',
      type: 'InvalidRun',
      message: 'The workflow was started without a run it can read',
    });
    expect(fake.commands()).toEqual([]);
  });
});
