import { describe, expect, it } from 'vitest';

import { interpret, workflow } from '../testing/workflows.ts';
import { mostHistoryBytes, mostHistoryEvents, mostStepsWithoutWaiting } from './run-state.ts';

const calling = workflow('do:\n  - fetch: { call: execute_spec, with: { primitive: inference, name: lookup } }');

describe('the history of a workflow', () => {
  it('stops the workflow with a clear error before it grows past what Temporal keeps', async () => {
    const { settlement } = await interpret(calling, { history: { bytes: mostHistoryBytes + 1, events: 10 } });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: `The workflow's history holds 10 events in ${mostHistoryBytes + 1} bytes, near the most Temporal keeps; it cannot do more (at /do/0/fetch)`,
    });
  });

  it('counts its events as well as its bytes, before a timer too', async () => {
    const document = workflow('do:\n  - slow: { set: {}, timeout: { after: PT1S } }');

    const { settlement } = await interpret(document, { history: { bytes: 1, events: mostHistoryEvents + 1 } });

    expect(settlement).toMatchObject({ status: 'rejected', reason: 'unavailable' });
  });

  it('is checked before a listen waits for an event', async () => {
    const listening = workflow('do:\n  - await: { listen: { to: { one: { with: { type: go } } } } }');

    const { settlement } = await interpret(listening, { history: { bytes: 1, events: mostHistoryEvents + 1 } });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: `The workflow's history holds ${mostHistoryEvents + 1} events in 1 bytes, near the most Temporal keeps; it cannot do more (at /do/0/await)`,
    });
  });
});

describe('a workflow that never waits', () => {
  it('is stopped once it has run too many tasks without waiting', async () => {
    const document = workflow(`
do:
  - spin:
      set: { turn: 1 }
      then: spin
`);

    expect((await interpret(document)).settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: `The workflow ran ${mostStepsWithoutWaiting} tasks without waiting for anything; it would never end (at /do/0/spin)`,
    });
  });

  it('may run many tasks as long as it waits in between', async () => {
    const document = workflow(`
do:
  - spin:
      for: { in: '\${ [range(0; 3)] }' }
      do:
        - count: { set: { turns: '\${ (.turns // 0) + 1 }' } }
        - rest: { wait: PT1S }
`);

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { turns: 3 } });
  });
});
