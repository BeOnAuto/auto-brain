import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunCommand } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import { runTaken } from './run-decisions.ts';
import type { RunEvent } from './run-events.ts';

const start = { by: 'brain:alpha', at: '2026-10-01T09:00:00.000Z' };

const finish = { by: 'brain:alpha', at: '2026-10-01T09:00:05.000Z' };

const greeting = { definition_type: 'echo', name: 'greet', input: { who: 'Ada' } };

function stateAfter(...events: readonly RunEvent[]) {
  return events.reduce((state, event) => runDecider.evolve(state, event), runDecider.initialState);
}

interface StartOptions {
  readonly depth?: number;
  readonly createOnly?: true;
  readonly trigger?: { readonly kind: 'event' | 'cron' | 'every'; readonly reference: string };
}

function starting(options: StartOptions): RunCommand {
  return { type: 'start', ...greeting, calls_tools: false, definition_version: 1, ...start, ...options };
}

const startedDeep: RunEvent = { type: 'run_started', ...greeting, definition_version: 1, depth: 2, ...start };

const finishing: RunCommand = {
  type: 'finish',
  result: { type: 'run_succeeded', output: 'Hi', record: {} },
  ...finish,
};

describe('the reaction depth of a run', () => {
  it('is recorded on its start when it is above 0, and on its ending, from the start', () => {
    expect([
      runDecider.decide(starting({ depth: 2 }), runDecider.initialState),
      runDecider.decide(starting({ depth: 0 }), runDecider.initialState),
      runDecider.decide(finishing, stateAfter(startedDeep)),
    ]).toEqual([
      Result.succeed([startedDeep]),
      Result.succeed([{ type: 'run_started', ...greeting, definition_version: 1, ...start }]),
      Result.succeed([
        {
          type: 'run_succeeded',
          output: 'Hi',
          record: {},
          definition_type: 'echo',
          name: 'greet',
          definition_version: 1,
          depth: 2,
          ...finish,
        },
      ]),
    ]);
  });
});

describe('the trigger that started a run', () => {
  it('is recorded on its start, and copied from the start onto every ending', () => {
    const trigger = { kind: 'cron' as const, reference: '/schedule/cron' };
    const startedByCron: RunEvent = {
      type: 'run_started',
      ...greeting,
      definition_version: 1,
      trigger,
      ...start,
    };
    const failing: RunCommand = { type: 'finish', result: { type: 'run_failed' }, ...finish };
    const ofTheRun = { definition_type: 'echo', name: 'greet', definition_version: 1, trigger, ...finish };

    expect([
      runDecider.decide(starting({ trigger }), runDecider.initialState),
      runDecider.decide(finishing, stateAfter(startedByCron)),
      runDecider.decide(failing, stateAfter(startedByCron)),
    ]).toEqual([
      Result.succeed([startedByCron]),
      Result.succeed([{ type: 'run_succeeded', output: 'Hi', record: {}, ...ofTheRun }]),
      Result.succeed([{ type: 'run_failed', ...ofTheRun }]),
    ]);
  });
});

describe('a start that only creates', () => {
  it('starts a run that does not exist, and again one that ended without a result, under the same request', () => {
    const failed: RunEvent = {
      type: 'run_failed',
      definition_type: 'echo',
      name: 'greet',
      definition_version: 1,
      ...finish,
    };

    expect([
      runDecider.decide(starting({ createOnly: true, depth: 2 }), runDecider.initialState),
      runDecider.decide(starting({ createOnly: true, depth: 2 }), stateAfter(startedDeep, failed)),
    ]).toEqual([Result.succeed([startedDeep]), Result.succeed([startedDeep])]);
  });

  it('is refused as taken for a run that goes, that ended with a result, or that another request ended', () => {
    const succeeded: RunEvent = {
      type: 'run_succeeded',
      definition_type: 'echo',
      name: 'greet',
      definition_version: 1,
      output: 'Hi',
      record: {},
      ...finish,
    };
    const failed: RunEvent = {
      type: 'run_failed',
      definition_type: 'echo',
      name: 'greet',
      definition_version: 1,
      ...finish,
    };
    const other: RunCommand = {
      type: 'start',
      ...greeting,
      input: { who: 'Grace' },
      calls_tools: false,
      definition_version: 1,
      ...start,
      createOnly: true,
    };

    expect([
      runDecider.decide(starting({ createOnly: true }), stateAfter(startedDeep)),
      runDecider.decide(starting({ createOnly: true }), stateAfter(startedDeep, succeeded)),
      runDecider.decide(other, stateAfter(startedDeep, failed)),
    ]).toEqual([Result.fail(runTaken), Result.fail(runTaken), Result.fail(runTaken)]);
  });
});
