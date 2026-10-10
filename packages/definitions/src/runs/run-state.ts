import type { Schema } from 'effect';

import type { StartingTrigger } from '../registry/definition-triggers.ts';
import type { RunResult } from './run-commands.ts';
import type {
  CalledBy,
  CancelRequestKind,
  DeliveryEnded,
  RunEvent,
  RunFinished,
  RunStarted,
  ReplyEvent,
  ReplyIdentity,
} from './run-events.ts';
import type { RunRecord } from './run.ts';

export interface AskedCancel {
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly by: string;
}

export interface BroughtAnswer {
  readonly answer: Schema.Json;
  readonly at: string;
  readonly reply: ReplyIdentity;
}

export interface RecordedRunState {
  readonly input: Schema.Json;
  readonly run: RunRecord;
  readonly finishesLater: boolean;
  readonly deferred: boolean;
  readonly callsTools: boolean;
  readonly lastCall: number;
  readonly mayHaveChanged: boolean;
  readonly calledOnlyReadOnly: boolean;
  readonly deliveryInFlight: number | null;
  readonly broughtAnswer: BroughtAnswer | null;
  readonly deliveredAt: string | null;
  readonly repliesSeen: readonly string[];
  readonly replyRefusals: number;
  readonly cancel?: AskedCancel;
  readonly depth: number;
  readonly callDepth: number;
  readonly calledBy?: CalledBy;
  readonly trigger?: StartingTrigger;
  readonly record?: Schema.JsonObject;
  readonly result?: RunResult;
}

export type RunState = RecordedRunState | undefined;

interface CancelledBeforeStart {
  readonly cancelledBeforeStart: AskedCancel;
}

export type RunStreamState = RunState | CancelledBeforeStart;

export function startedRunOf(state: RunStreamState): RunState {
  return state === undefined || 'cancelledBeforeStart' in state ? undefined : state;
}

export function cancelBeforeStartOf(state: RunStreamState): AskedCancel | undefined {
  return state !== undefined && 'cancelledBeforeStart' in state ? state.cancelledBeforeStart : undefined;
}

type CallsBefore = Pick<RecordedRunState, 'lastCall' | 'mayHaveChanged' | 'calledOnlyReadOnly'>;

const noCallsBefore: CallsBefore = { lastCall: 0, mayHaveChanged: false, calledOnlyReadOnly: true };

function callsBefore(earlier: RunState): CallsBefore {
  return earlier === undefined
    ? noCallsBefore
    : {
        lastCall: earlier.lastCall,
        mayHaveChanged: earlier.mayHaveChanged,
        calledOnlyReadOnly: earlier.calledOnlyReadOnly,
      };
}

function startedRun(event: RunStarted, earlier: RunState): RecordedRunState {
  const {
    definition_type: type,
    name,
    definition_version,
    input,
    calls_tools,
    finishes_later,
    depth = 0,
    by,
    at,
  } = event;
  const { call_depth: callDepth = 0, called_by: calledBy, trigger } = event;
  return {
    input,
    run: { type, name, definition_version, status: 'started', started_at: at, started_by: by },
    finishesLater: finishes_later === true,
    deferred: false,
    callsTools: calls_tools === true,
    ...callsBefore(earlier),
    deliveryInFlight: null,
    broughtAnswer: null,
    deliveredAt: null,
    repliesSeen: [],
    replyRefusals: 0,
    depth,
    callDepth,
    ...(calledBy === undefined ? {} : { calledBy }),
    ...(trigger === undefined ? {} : { trigger }),
  };
}

function resultOf(event: RunFinished): RunResult {
  if (event.type === 'run_succeeded') {
    return { type: event.type, output: event.output, record: event.record };
  }
  if (event.type === 'run_rejected') {
    return { type: event.type, rejection: event.rejection };
  }
  return event.incident === undefined ? { type: event.type } : { type: event.type, incident: event.incident };
}

function finishedRecord(
  { type, name, definition_version, started_at, started_by }: RunRecord,
  result: RunResult,
  at: string,
): RunRecord {
  const attempt = { type, name, definition_version, started_at, started_by, finished_at: at };
  if (result.type === 'run_succeeded') {
    return { ...attempt, status: 'succeeded', output: result.output };
  }
  if (result.type === 'run_rejected') {
    return { ...attempt, status: 'rejected', rejection: result.rejection };
  }
  return { ...attempt, status: 'failed' };
}

function recordOf(event: RunFinished): Schema.JsonObject | undefined {
  return event.type === 'run_failed' ? undefined : event.record;
}

function finishedRun(state: RecordedRunState, event: RunFinished): RecordedRunState {
  const result = resultOf(event);
  const finished = { ...state, run: finishedRecord(state.run, result, event.at), result };
  const record = recordOf(event);
  return record === undefined ? finished : { ...finished, record };
}

function endedDelivery(state: RecordedRunState, { outcome, at }: DeliveryEnded): RecordedRunState {
  const ended = { ...state, deliveryInFlight: null };
  return outcome === 'delivered' ? { ...ended, deliveredAt: at } : ended;
}

function repliedTo(state: RecordedRunState, event: ReplyEvent): RecordedRunState {
  const seen = { ...state, repliesSeen: [...state.repliesSeen, event.reply.id] };
  if (event.type === 'reply_refused') {
    return { ...seen, replyRefusals: state.replyRefusals + 1 };
  }
  const { answer, at, reply } = event;
  return { ...seen, broughtAnswer: { answer, at, reply } };
}

function evolveStarted(state: RecordedRunState, event: Exclude<RunEvent, RunStarted>): RecordedRunState {
  if (event.type === 'reply_taken' || event.type === 'reply_refused') {
    return repliedTo(state, event);
  }
  if (event.type === 'tool_call_started') {
    return {
      ...state,
      lastCall: event.number,
      mayHaveChanged: true,
      calledOnlyReadOnly: state.calledOnlyReadOnly && event.read_only === true,
    };
  }
  if (event.type === 'delivery_started') {
    return { ...state, lastCall: event.number, deliveryInFlight: event.number };
  }
  if (event.type === 'delivery_ended') {
    return endedDelivery(state, event);
  }
  if (event.type === 'tool_call_answered') {
    return state;
  }
  if (event.type === 'run_cancel_requested') {
    const { kind, reason, by } = event;
    return { ...state, cancel: { kind, reason, by } };
  }
  return event.type === 'run_deferred' ? { ...state, deferred: true, record: event.record } : finishedRun(state, event);
}

export function evolveRun(state: RunStreamState, event: RunEvent): RunStreamState {
  if (event.type === 'run_started') {
    return startedRun(event, startedRunOf(state));
  }
  const run = startedRunOf(state);
  if (run !== undefined) {
    return evolveStarted(run, event);
  }
  if (state === undefined && event.type === 'run_cancel_requested') {
    const { kind, reason, by } = event;
    return { cancelledBeforeStart: { kind, reason, by } };
  }
  return state;
}

export function hasFinalResult({ run }: RecordedRunState): boolean {
  const reason = run.rejection?.reason;
  return run.status === 'succeeded' || reason === 'invalid_input' || reason === 'cancelled' || reason === 'unanswered';
}

export function awaitsSettlement({ run, deferred }: RecordedRunState): boolean {
  return run.status === 'started' && deferred;
}

export function takesSettlement({ run, finishesLater, deferred }: RecordedRunState): boolean {
  return run.status === 'started' && (finishesLater || deferred);
}

export function isRunning({ run }: RecordedRunState): boolean {
  return run.status === 'started';
}

export function lastCallOf(state: RunState): number {
  return state?.lastCall ?? 0;
}

export function mayHaveChangedSomething({ mayHaveChanged }: RecordedRunState): boolean {
  return mayHaveChanged;
}

export function changedNothing(state: RecordedRunState): boolean {
  return state.mayHaveChanged && state.calledOnlyReadOnly && !isRunning(state);
}
