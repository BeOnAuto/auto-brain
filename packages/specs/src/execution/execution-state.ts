import type { Schema } from 'effect';

import type { ExecutionResult } from './execution-commands.ts';
import type {
  CalledBy,
  CancelRequestKind,
  DeliveryOutcome,
  ExecutionEvent,
  ExecutionFinished,
  ExecutionStarted,
} from './execution-events.ts';
import type { ExecutionRecord } from './execution.ts';

export interface AskedCancel {
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly by: string;
}

export interface EndedDelivery {
  readonly outcome: DeliveryOutcome;
  readonly answer?: Schema.Json;
  readonly at: string;
}

export interface RecordedExecution {
  readonly input: Schema.Json;
  readonly execution: ExecutionRecord;
  readonly finishesLater: boolean;
  readonly deferred: boolean;
  readonly callsTools: boolean;
  readonly lastCall: number;
  readonly mayHaveChanged: boolean;
  readonly deliveryInFlight: number | null;
  readonly lastDelivery: EndedDelivery | null;
  readonly cancel?: AskedCancel;
  readonly depth: number;
  readonly callDepth: number;
  readonly calledBy?: CalledBy;
  readonly record?: Schema.JsonObject;
  readonly result?: ExecutionResult;
}

export type ExecutionState = RecordedExecution | undefined;

interface CancelledBeforeStart {
  readonly cancelledBeforeStart: AskedCancel;
}

export type ExecutionStreamState = ExecutionState | CancelledBeforeStart;

export function runOf(state: ExecutionStreamState): ExecutionState {
  return state === undefined || 'cancelledBeforeStart' in state ? undefined : state;
}

export function cancelBeforeStartOf(state: ExecutionStreamState): AskedCancel | undefined {
  return state !== undefined && 'cancelledBeforeStart' in state ? state.cancelledBeforeStart : undefined;
}

function startedExecution(event: ExecutionStarted, earlier: ExecutionState): RecordedExecution {
  const { primitive, name, spec_version, input, calls_tools, finishes_later, depth = 0, by, at } = event;
  const { call_depth: callDepth = 0, called_by: calledBy } = event;
  return {
    input,
    execution: { primitive, name, spec_version, status: 'started', started_at: at, started_by: by },
    finishesLater: finishes_later === true,
    deferred: false,
    callsTools: calls_tools === true,
    lastCall: earlier?.lastCall ?? 0,
    mayHaveChanged: earlier?.mayHaveChanged ?? false,
    deliveryInFlight: null,
    lastDelivery: null,
    depth,
    callDepth,
    ...(calledBy === undefined ? {} : { calledBy }),
  };
}

function resultOf(event: ExecutionFinished): ExecutionResult {
  if (event.type === 'execution_succeeded') {
    return { type: event.type, output: event.output, record: event.record };
  }
  if (event.type === 'execution_rejected') {
    return { type: event.type, rejection: event.rejection };
  }
  return event.incident === undefined ? { type: event.type } : { type: event.type, incident: event.incident };
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
    return { ...state, lastCall: event.number, mayHaveChanged: true };
  }
  if (event.type === 'delivery_started') {
    return { ...state, lastCall: event.number, deliveryInFlight: event.number };
  }
  if (event.type === 'delivery_ended') {
    const { outcome, answer, at } = event;
    return {
      ...state,
      deliveryInFlight: null,
      lastDelivery: answer === undefined ? { outcome, at } : { outcome, answer, at },
    };
  }
  if (event.type === 'tool_call_answered') {
    return state;
  }
  if (event.type === 'execution_cancel_requested') {
    const { kind, reason, by } = event;
    return { ...state, cancel: { kind, reason, by } };
  }
  return event.type === 'execution_deferred'
    ? { ...state, deferred: true, record: event.record }
    : finishedExecution(state, event);
}

export function evolveExecution(state: ExecutionStreamState, event: ExecutionEvent): ExecutionStreamState {
  if (event.type === 'execution_started') {
    return startedExecution(event, runOf(state));
  }
  const run = runOf(state);
  if (run !== undefined) {
    return evolveStarted(run, event);
  }
  if (state === undefined && event.type === 'execution_cancel_requested') {
    const { kind, reason, by } = event;
    return { cancelledBeforeStart: { kind, reason, by } };
  }
  return state;
}

export function hasFinalResult({ execution }: RecordedExecution): boolean {
  const reason = execution.rejection?.reason;
  return (
    execution.status === 'succeeded' || reason === 'invalid_input' || reason === 'cancelled' || reason === 'unanswered'
  );
}

export function awaitsSettlement({ execution, deferred }: RecordedExecution): boolean {
  return execution.status === 'started' && deferred;
}

export function takesSettlement({ execution, finishesLater, deferred }: RecordedExecution): boolean {
  return execution.status === 'started' && (finishesLater || deferred);
}

export function isRunning({ execution }: RecordedExecution): boolean {
  return execution.status === 'started';
}

export function lastCallOf(state: ExecutionState): number {
  return state?.lastCall ?? 0;
}

export function mayHaveChangedSomething({ mayHaveChanged }: RecordedExecution): boolean {
  return mayHaveChanged;
}
