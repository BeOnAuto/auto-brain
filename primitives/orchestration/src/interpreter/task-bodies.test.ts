import { describe, expect, it } from 'vitest';

import { fakeHost } from '../testing/fake-host.ts';
import { runOf, workflow } from '../testing/workflows.ts';
import { makeRunState } from './run-state.ts';
import { bodyFor } from './task-bodies.ts';
import { runner } from './task-runner.ts';

describe('the bodies of tasks', () => {
  it('reject the tasks the policy rejects', () => {
    const entry = { name: 'shell', task: { run: {} }, reference: '/do/0/shell' };
    const state = makeRunState(runOf(workflow('do: []')), fakeHost().host);
    const scope = { state, variables: {} };
    const invocation = { entry, configuration: {}, input: null, variables: {}, scope, run: 1, runner };

    expect(() => bodyFor('run')(invocation)).toThrow('emit and run tasks are not allowed by this runtime');
  });
});
