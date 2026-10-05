import { describe, expect, it } from 'vitest';

import { RaisedError } from '../dsl/raised-error.ts';
import type { TaskKind } from '../dsl/tasks.ts';
import { newRun } from '../machine/run-state.ts';
import type { Invocation } from '../runner/advance.ts';
import { runner } from '../runner/runner.ts';
import { sessionOf } from '../runner/session.ts';
import { testMachine } from '../testing/driver-inputs.ts';
import { startBody } from './task-bodies.ts';

function invocationOf(kind: TaskKind, configuration: number | string): Invocation {
  const session = sessionOf(newRun, 0, testMachine);
  const input = session.hold(null);
  const reference = '/do/0/odd';
  return {
    machine: { session, runner },
    frame: {
      reference,
      run: 1,
      startedAt: 0,
      context: session.context(),
      rawInput: input,
      input,
      variables: {},
      timeout: null,
    },
    entry: { name: 'odd', task: { [kind]: configuration }, reference },
    kind,
    configuration,
    input: null,
    variables: {},
  };
}

function titleOfStarting(kind: TaskKind, configuration: number | string): string | undefined {
  try {
    startBody(kind, invocationOf(kind, configuration));
    return undefined;
  } catch (error) {
    return error instanceof RaisedError ? error.error.title : String(error);
  }
}

describe('the body of a task that reached the machine unchecked', () => {
  it.each(['emit', 'run'] as const)('refuses a %s task', (kind) => {
    expect(titleOfStarting(kind, 3)).toBe('emit and run tasks are not allowed by this runtime');
  });

  it.each([3, ''])('refuses a call of no function: %s', (configuration) => {
    expect(titleOfStarting('call', configuration)).toBe('call names no function');
  });
});
