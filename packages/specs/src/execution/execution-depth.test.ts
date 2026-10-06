import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ExecutionCommand } from './execution-commands.ts';
import { executionDecider } from './execution-decider.ts';
import type { ExecutionEvent } from './execution-events.ts';

const start = { by: 'brain:alpha', at: '2026-10-01T09:00:00.000Z' };

const finish = { by: 'brain:alpha', at: '2026-10-01T09:00:05.000Z' };

const greeting = { primitive: 'echo', name: 'greet', input: { who: 'Ada' } };

function stateAfter(...events: readonly ExecutionEvent[]) {
  return events.reduce((state, event) => executionDecider.evolve(state, event), executionDecider.initialState);
}

interface StartOptions {
  readonly depth?: number;
  readonly createOnly?: true;
}

function starting(options: StartOptions): ExecutionCommand {
  return { type: 'start', ...greeting, calls_tools: false, spec_version: 1, ...start, ...options };
}

const startedDeep: ExecutionEvent = { type: 'execution_started', ...greeting, spec_version: 1, depth: 2, ...start };

const finishing: ExecutionCommand = {
  type: 'finish',
  result: { type: 'execution_succeeded', output: 'Hi', record: {} },
  ...finish,
};

describe('the reaction depth of a run', () => {
  it('is recorded on its start when it is above 0, and on its ending, from the start', () => {
    expect([
      executionDecider.decide(starting({ depth: 2 }), executionDecider.initialState),
      executionDecider.decide(starting({ depth: 0 }), executionDecider.initialState),
      executionDecider.decide(finishing, stateAfter(startedDeep)),
    ]).toEqual([
      Result.succeed([startedDeep]),
      Result.succeed([{ type: 'execution_started', ...greeting, spec_version: 1, ...start }]),
      Result.succeed([
        {
          type: 'execution_succeeded',
          output: 'Hi',
          record: {},
          primitive: 'echo',
          name: 'greet',
          spec_version: 1,
          depth: 2,
          ...finish,
        },
      ]),
    ]);
  });
});

describe('a start that only creates', () => {
  it('records nothing for a run that exists, however it ended, and starts one that does not', () => {
    const failed: ExecutionEvent = {
      type: 'execution_failed',
      primitive: 'echo',
      name: 'greet',
      spec_version: 1,
      ...finish,
    };

    expect([
      executionDecider.decide(starting({ createOnly: true }), stateAfter(startedDeep, failed)),
      executionDecider.decide(starting({ createOnly: true, depth: 2 }), executionDecider.initialState),
    ]).toEqual([Result.succeed([]), Result.succeed([startedDeep])]);
  });
});
