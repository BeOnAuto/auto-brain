import type { Schema } from 'effect';

import type { ExecutionResult } from './execution-commands.ts';
import type { ExecutionEvent, ExecutionFinished, ExecutionStarted } from './execution-events.ts';
import type { ExecutionRecord } from './execution.ts';

export interface RecordedExecution {
  readonly input: Schema.Json;
  readonly execution: ExecutionRecord;
  readonly finishesLater: boolean;
  readonly callsTools: boolean;
  readonly toolCalls: number;
  readonly depth: number;
  readonly record?: Schema.JsonObject;
  readonly result?: ExecutionResult;
}

export type ExecutionState = RecordedExecution | undefined;

function startedExecution(
  { primitive, name, spec_version, input, calls_tools, depth = 0, by, at }: ExecutionStarted,
  earlier: ExecutionState,
): RecordedExecution {
  return {
    input,
    execution: { primitive, name, spec_version, status: 'started', started_at: at, started_by: by },
    finishesLater: false,
    callsTools: calls_tools === true,
    toolCalls: earlier?.toolCalls ?? 0,
    depth,
  };
}

function resultOf(event: ExecutionFinished): ExecutionResult {
  if (event.type === 'execution_succeeded') {
    return { type: event.type, output: event.output, record: event.record };
  }
  if (event.type === 'execution_rejected') {
    return { type: event.type, rejection: event.rejection };
  }
  return { type: event.type };
}

function finishedRecord(
  { primitive, name, spec_version, started_at, started_by }: ExecutionRecord,
  result: ExecutionResult,
  at: string,
): ExecutionRecord {
  const attempt = { primitive, name, spec_version, started_at, started_by, finished_at: at };
  if (result.type === 'execution_succeeded') {
    return { ...attempt, status: 'succeeded', output: result.output };
  }
  if (result.type === 'execution_rejected') {
    return { ...attempt, status: 'rejected', rejection: result.rejection };
  }
  return { ...attempt, status: 'failed' };
}

function recordOf(event: ExecutionFinished): Schema.JsonObject | undefined {
  return event.type === 'execution_failed' ? undefined : event.record;
}

function finishedExecution(state: RecordedExecution, event: ExecutionFinished): RecordedExecution {
  const result = resultOf(event);
  const finished = { ...state, execution: finishedRecord(state.execution, result, event.at), result };
  const record = recordOf(event);
  return record === undefined ? finished : { ...finished, record };
}

function evolveStarted(state: RecordedExecution, event: Exclude<ExecutionEvent, ExecutionStarted>): RecordedExecution {
  if (event.type === 'tool_call_started') {
    return { ...state, toolCalls: state.toolCalls + 1 };
  }
  if (event.type === 'tool_call_answered') {
    return state;
  }
  return event.type === 'execution_deferred'
    ? { ...state, finishesLater: true, record: event.record }
    : finishedExecution(state, event);
}

export function evolveExecution(state: ExecutionState, event: ExecutionEvent): ExecutionState {
  if (event.type === 'execution_started') {
    return startedExecution(event, state);
  }
  return state === undefined ? state : evolveStarted(state, event);
}

export function hasFinalResult({ execution }: RecordedExecution): boolean {
  return execution.status === 'succeeded' || execution.rejection?.reason === 'invalid_input';
}

export function awaitsSettlement({ execution, finishesLater }: RecordedExecution): boolean {
  return execution.status === 'started' && finishesLater;
}

export function isRunning({ execution }: RecordedExecution): boolean {
  return execution.status === 'started';
}

export function calledTools({ toolCalls }: RecordedExecution): boolean {
  return toolCalls > 0;
}
