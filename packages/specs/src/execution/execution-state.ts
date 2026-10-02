import type { Schema } from 'effect';

import type { ExecutionResult } from './execution-commands.ts';
import type { ExecutionEvent, ExecutionFinished, ExecutionStarted } from './execution-events.ts';
import type { ExecutionRecord } from './execution.ts';

export interface RecordedExecution {
  readonly input: Schema.Json;
  readonly execution: ExecutionRecord;
  readonly finishesLater: boolean;
  readonly record?: Schema.JsonObject;
  readonly result?: ExecutionResult;
}

export type ExecutionState = RecordedExecution | undefined;

function startedExecution({ primitive, name, spec_version, input, by, at }: ExecutionStarted): RecordedExecution {
  return {
    input,
    execution: { primitive, name, spec_version, status: 'started', started_at: at, started_by: by },
    finishesLater: false,
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

function finishedExecution(state: RecordedExecution, event: ExecutionFinished): RecordedExecution {
  const result = resultOf(event);
  const finished = { ...state, execution: finishedRecord(state.execution, result, event.at), result };
  return event.type === 'execution_succeeded' ? { ...finished, record: event.record } : finished;
}

export function evolveExecution(state: ExecutionState, event: ExecutionEvent): ExecutionState {
  if (event.type === 'execution_started') {
    return startedExecution(event);
  }
  if (state === undefined) {
    return state;
  }
  return event.type === 'execution_deferred'
    ? { ...state, finishesLater: true, record: event.record }
    : finishedExecution(state, event);
}

export function hasFinalResult({ execution }: RecordedExecution): boolean {
  return execution.status === 'succeeded' || execution.rejection?.reason === 'invalid_input';
}

export function awaitsSettlement({ execution, finishesLater }: RecordedExecution): boolean {
  return execution.status === 'started' && finishesLater;
}
