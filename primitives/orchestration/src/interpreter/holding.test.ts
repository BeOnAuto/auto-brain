import { RaisedError } from '@beonauto/workflow-engine/dsl/raised-error';
import { describe, expect, it } from 'vitest';

import { fakeHost } from '../testing/fake-host.ts';
import { runOf, workflow } from '../testing/workflows.ts';
import { mostHeldBytes, taskFrameBytes } from './holding.ts';
import { retainedBytesOf } from './retained-size.ts';
import { makeRunState } from './run-state.ts';

function holderOf() {
  return makeRunState(runOf(workflow('do: []')), fakeHost().host).hold;
}

function failureOf(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  return undefined;
}

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
