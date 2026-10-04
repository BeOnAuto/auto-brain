import { describe, expect, it } from 'vitest';

import { fakeHost } from '../testing/fake-host.ts';
import { interpret, runOf, workflow } from '../testing/workflows.ts';
import { mostHeldBytes, taskFrameBytes } from './holding.ts';
import type { RunSettlement } from './host.ts';
import { RaisedError } from './raised-error.ts';
import { retainedBytesOf } from './retained-size.ts';
import { makeRunState } from './run-state.ts';

function holderOf() {
  return makeRunState(runOf(workflow('do: []')), fakeHost().host).hold;
}

function branch(name: string): string {
  return `- ${name}: { do: [{ big: { set: { s: '\${ "x" * 2000000 }' } } }, { rest: { wait: PT1H } }] }`;
}

function rejectionDetailOf(settlement: RunSettlement | undefined): string {
  return settlement?.status === 'rejected' ? settlement.detail : '';
}

function failureOf(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('the data a workflow holds at once', () => {
  it('counts what every running task holds, so branches that each keep a large value fail the workflow', async () => {
    const document = workflow(
      `do:\n  - spread:\n      fork:\n        branches:\n${['a', 'b', 'c', 'd', 'e'].map((name) => `          ${branch(name)}`).join('\n')}\n`,
    );

    const { settlement } = await interpret(document);

    expect(settlement).toMatchObject({ status: 'rejected', reason: 'unavailable' });
    expect(rejectionDetailOf(settlement)).toMatch(
      new RegExp(
        `^The workflow would hold about \\d+ bytes of data at once, more than the ${mostHeldBytes} a workflow may hold \\(at /do/0/spread/fork/branches/\\d+/\\w/do/\\d+/(big|rest)\\)$`,
        'u',
      ),
    );
  });

  it('lets go of what a task held once it finishes, so large values in turn fit', async () => {
    const step = `{ set: { s: '\${ "x" * 3000000 }' } }`;
    const steps = ['a', 'b', 'c', 'd', 'e'].map((name) => `  - ${name}: ${step}`).join('\n');
    const document = workflow(`do:\n${steps}\n  - done: { set: { done: true } }\n`);

    const { ending } = await interpret(document);

    expect(ending).toEqual({ kind: 'completed', output: { done: true } });
  });
});

describe('holding values', () => {
  it('counts a value held twice once, and lets go of it when the last holder does', () => {
    const hold = holderOf();
    const value = { s: 'x'.repeat(1000) };
    const first = hold([value], '/a');
    const second = hold([value, value], '/b');
    second();
    second();
    first();
    const failure = failureOf(() => hold(['x'.repeat(mostHeldBytes / 4)], '/c'));

    expect(failure).toBeUndefined();
  });

  it('refuses what would take it past the limit, naming the task, and holds nothing of it', () => {
    const hold = holderOf();
    const near = 'x'.repeat((mostHeldBytes - retainedBytesOf({}) - 4 * taskFrameBytes) / 2 - 64);
    hold([near], '/a');

    const failure = failureOf(() => hold(['x'.repeat(10_000)], '/b'));
    const after = failureOf(() => hold([], '/c'));

    expect(failure).toBeInstanceOf(RaisedError);
    expect(failure).toMatchObject({ error: { status: 500, instance: '/b' } });
    expect(after).toBeUndefined();
  });
});
