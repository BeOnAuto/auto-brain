import { describe, expect, it } from 'vitest';

import { drivenRun, outputKindsIn } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { withoutUndone } from './run-events.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

describe('the outputs of an event', () => {
  it('leave out a timer the same input armed and cancelled, such as the deadline of a run that ends at once', () => {
    const run = drivenRun(workflow('do:\n  - greet: { set: { done: true } }'));

    expect(outputKindsIn(run.events)).toEqual(['settle']);
  });

  it('leave out a call the same input started and cancelled, and its deadline', () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - asking: { call: notify, with: { to: ada } }
          - refusing: { raise: { error: { type: https://example.com/refused, status: 409 } } }
`);

    expect(outputKindsIn(drivenRun(document).events)).toEqual(['settle']);
  });

  it('keep a cancel of what an earlier input armed or started', () => {
    const key = { executionId, reference: '/do/0/ask', run: 1 };
    const outputs = [
      { kind: 'cancel_timer', executionId, timerId: `${executionId}/timers/1` },
      { kind: 'cancel_call', key },
      { kind: 'arm_timer', executionId, timerId: `${executionId}/timers/2`, dueAt: 1, purpose: 'wait' },
    ] as const;

    expect(withoutUndone(outputs)).toEqual(outputs);
  });
});
