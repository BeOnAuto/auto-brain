import type { Schema } from 'effect';

import type { ExecutionEvent, ExecutionFinished, ExecutionStarted } from './execution-events.ts';
import type { ExecutionRecord } from './execution.ts';

export interface RecordedExecution {
  readonly input: Schema.Json;
  readonly execution: ExecutionRecord;
}

export type ExecutionState = RecordedExecution | undefined;

function startedExecution({ primitive, name, spec_version, input, by, at }: ExecutionStarted): RecordedExecution {
  return { input, execution: { primitive, name, spec_version, status: 'started', started_at: at, started_by: by } };
}

function finishedRecord(
  { primitive, name, spec_version, started_at, started_by }: ExecutionRecord,
  event: ExecutionFinished,
): ExecutionRecord {
  const attempt = { primitive, name, spec_version, started_at, started_by, finished_at: event.at };
  if (event.type === 'execution_succeeded') {
    return { ...attempt, status: 'succeeded', output: event.output };
  }
  if (event.type === 'execution_rejected') {
    return { ...attempt, status: 'rejected', rejection: event.rejection };
  }
  return { ...attempt, status: 'failed' };
}

export function evolveExecution(state: ExecutionState, event: ExecutionEvent): ExecutionState {
  if (event.type === 'execution_started') {
    return startedExecution(event);
  }
  return state === undefined ? state : { input: state.input, execution: finishedRecord(state.execution, event) };
}

export function hasFinalResult({ execution }: RecordedExecution): boolean {
  return execution.status === 'succeeded' || execution.rejection?.reason === 'invalid_input';
}
