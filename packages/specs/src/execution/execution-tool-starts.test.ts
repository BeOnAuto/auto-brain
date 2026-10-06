import { Conflict } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ExecutionCommand } from './execution-commands.ts';
import { executionDecider } from './execution-decider.ts';
import type { ExecutionEvent } from './execution-events.ts';

const start = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const finish = { by: 'acme-admin', at: '2026-10-01T09:00:05.000Z' };

const greeting = { primitive: 'echo', name: 'greet', input: { who: 'Ada', tags: ['a', 'b'] } };

const started: ExecutionEvent = { type: 'execution_started', ...greeting, spec_version: 1, ...start };

const succeeded: ExecutionEvent = { type: 'execution_succeeded', output: 'Hello Ada', record: {}, ...finish };

const unavailable: ExecutionEvent = {
  type: 'execution_rejected',
  rejection: { reason: 'unavailable', detail: 'The model is busy' },
  ...finish,
};

const failed: ExecutionEvent = { type: 'execution_failed', ...finish };

const anotherRequest = new Conflict({
  detail: 'The run id belongs to a run of another definition or with another input',
});

function stateAfter(...events: readonly ExecutionEvent[]) {
  return events.reduce((state, event) => executionDecider.evolve(state, event), executionDecider.initialState);
}

function decided(command: ExecutionCommand, ...history: readonly ExecutionEvent[]) {
  return executionDecider.decide(command, stateAfter(...history));
}

function starting(request: object = {}): ExecutionCommand {
  return { type: 'start', ...greeting, calls_tools: false, ...request, spec_version: 1, ...start };
}

const startedCallingTools = new Conflict({
  detail:
    'The run has started and its definition calls tools, so it is not run again under its id: it may still be in progress, or have stopped without recording how it ended, and its tools may have changed something; start a new run with another run id, and read with get_execution_history what it has called so far',
  kind: 'tools_called',
});

describe('starting an execution whose spec calls tools', () => {
  const callingTools = starting({ calls_tools: true });

  const startedWithTools: ExecutionEvent = { ...started, calls_tools: true };

  it('records it the first time, with the fact that it calls tools', () => {
    expect(decided(callingTools)).toStrictEqual(Result.succeed([startedWithTools]));
  });

  it('refuses it while an earlier attempt is started, before any call is recorded, since it may be in progress', () => {
    expect(decided(callingTools, started)).toEqual(Result.fail(startedCallingTools));
  });

  it('refuses any start while an attempt recorded as calling tools is started, though its spec has lost its tools since', () => {
    expect(decided(starting(), startedWithTools)).toEqual(Result.fail(startedCallingTools));
    expect(stateAfter(startedWithTools)).toMatchObject({ callsTools: true });
    expect(stateAfter(started)).toMatchObject({ callsTools: false });
  });

  it('records it again after an attempt that ended before any call, since no tool was called', () => {
    expect(decided(callingTools, startedWithTools, unavailable)).toStrictEqual(Result.succeed([startedWithTools]));
    expect(decided(callingTools, started, failed)).toStrictEqual(Result.succeed([startedWithTools]));
  });

  it('answers a finished execution again, and refuses another request under its id as any other', () => {
    expect(decided(callingTools, started, succeeded)).toStrictEqual(Result.succeed([]));
    expect(decided(starting({ calls_tools: true, name: 'wave' }), started)).toEqual(Result.fail(anotherRequest));
  });
});
