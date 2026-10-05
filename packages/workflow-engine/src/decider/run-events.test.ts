import { describe, expect, it } from 'vitest';

import type { MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRun, outputKindsIn } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { withoutUndone } from './run-events.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const inboxLists = /^\/inbox\/(?:receivedIds|waiting)(?:\/|$)/u;

function declinedThenApproved(driver: MemoryDriver, running: string): void {
  driver.at(1, () => {
    driver.deliver(running, { id: 'd', type: 'declined' });
  });
  driver.at(2, () => {
    driver.deliver(running, { id: 'a', type: 'approved' });
  });
}

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
      { kind: 'cancel_timer', executionId, timerId: '1' },
      { kind: 'cancel_call', key },
      { kind: 'arm_timer', executionId, timerId: '2', dueAt: 1, purpose: 'wait' },
    ] as const;

    expect(withoutUndone(outputs)).toEqual(outputs);
  });
});

describe('the steps of an event', () => {
  it('are one for each run of a task the input stepped, with its last outcome, in the order the tasks started', () => {
    const document = workflow(`
do:
  - outer:
      do:
        - inner: { set: { a: 1 } }
        - pause: { wait: PT1S }
`);
    const steps = drivenRun(document).events.map(({ event }) =>
      event.steps.map(({ reference, run, outcome }) => `${reference} ${run} ${outcome}`),
    );

    expect(steps).toEqual([
      ['/do/0/outer 1 started', '/do/0/outer/do/0/inner 1 completed', '/do/0/outer/do/1/pause 1 waiting'],
      ['/do/0/outer/do/1/pause 1 completed', '/do/0/outer 1 completed'],
    ]);
  });
});

describe('the patch of an event', () => {
  it('appends to a list that only grew, and replaces one that lost items', () => {
    const document = workflow('do:\n  - await: { listen: { to: { one: { with: { type: approved } } } } }');
    const run = drivenRun(document, { meanwhile: declinedThenApproved });
    const operations = run.events.map(({ event }) => event.patch.filter(({ path }) => inboxLists.test(path)));
    const event = { id: 'd', type: 'declined' };
    const declined = { event, bytes: JSON.stringify(event).length };

    expect(operations).toEqual([
      [],
      [
        { op: 'add', path: '/inbox/waiting/-', value: declined },
        { op: 'add', path: '/inbox/receivedIds/-', value: 'd' },
      ],
      [
        { op: 'replace', path: '/inbox/waiting', value: [] },
        { op: 'add', path: '/inbox/receivedIds/-', value: 'a' },
      ],
    ]);
  });
});
