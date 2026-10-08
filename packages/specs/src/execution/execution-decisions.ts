import { Conflict, NotFound, RunCancelled, type Rejection } from '@beonauto/operations';
import { Equal, Result } from 'effect';

import { decideOutboundCall, decideToolCall, ofTheDefinition } from '../run-work/work-decisions.ts';
import type {
  CommandMetadata,
  ExecutionCancel,
  ExecutionCommand,
  ExecutionFinish,
  ExecutionOutcome,
  ExecutionRequest,
  ExecutionSettlement,
  ExecutionStart,
  InterruptedAttempt,
} from './execution-commands.ts';
import type { ExecutionEvent } from './execution-events.ts';
import {
  awaitsSettlement,
  cancelBeforeStartOf,
  hasFinalResult,
  isRunning,
  mayHaveChangedSomething,
  runOf,
  takesSettlement,
  type ExecutionState,
  type ExecutionStreamState,
  type RecordedExecution,
} from './execution-state.ts';
import { settlementKeyOf, succeedsWith } from './settlement-keys.ts';

type Decision = Result.Result<readonly ExecutionEvent[], Rejection<'not_found' | 'conflict' | 'cancelled'>>;

export type Claim = 'run' | 'answer';

const nothingToRecord: Decision = Result.succeed([]);

const toolsWereCalled = new Conflict({
  detail:
    'The run called tools and did not succeed, so it is not run again under its id, since a tool may have changed something; start a new run with another run id, and read with get_execution_history what it called',
  kind: 'tools_called',
});

const startedCallingTools = new Conflict({
  detail:
    'The run has started and its definition calls tools, so it is not run again under its id: it may still be in progress, or have stopped without recording how it ended, and its tools may have changed something; start a new run with another run id, and read with get_execution_history what it has called so far',
  kind: 'tools_called',
});

const noSuchRun = new NotFound({ detail: 'There is no such run in this brain' });

export const runTaken = new Conflict({
  detail: 'A run under this id is going or has ended with a result, so this start records nothing',
  kind: 'taken',
});

export const endedBeforeCancelling = new Conflict({
  detail: 'The run has already ended, so there is nothing left to cancel',
});

const runsWithinItsCall = new Conflict({
  detail:
    'The run runs within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
});

function isSameRequest({ input, execution }: RecordedExecution, request: ExecutionRequest): boolean {
  return (
    execution.primitive === request.primitive && execution.name === request.name && Equal.equals(input, request.input)
  );
}

function needsNoRun(state: RecordedExecution): boolean {
  return hasFinalResult(state) || awaitsSettlement(state);
}

function claimOfRecorded(state: RecordedExecution): Result.Result<Claim, Conflict> {
  if (needsNoRun(state)) {
    return Result.succeed('answer');
  }
  return mayHaveChangedSomething(state) ? Result.fail(toolsWereCalled) : Result.succeed('run');
}

function cancelledBeforeItsStart(state: ExecutionStreamState): RunCancelled | undefined {
  const cancel = cancelBeforeStartOf(state);
  return cancel === undefined ? undefined : new RunCancelled({ detail: cancel.reason, kind: cancel.kind });
}

export function claimOf(
  state: ExecutionStreamState,
  request: ExecutionRequest,
): Result.Result<Claim, Conflict | RunCancelled> {
  const cancelled = cancelledBeforeItsStart(state);
  if (cancelled !== undefined) {
    return Result.fail(cancelled);
  }
  const run = runOf(state);
  if (run === undefined) {
    return Result.succeed('run');
  }
  if (!isSameRequest(run, request)) {
    return Result.fail(
      new Conflict({ detail: 'The run id belongs to a run of another definition or with another input' }),
    );
  }
  return claimOfRecorded(run);
}

function startedCallingToolsBefore(start: ExecutionStart, state: ExecutionState): boolean {
  return state !== undefined && isRunning(state) && (state.callsTools || start.calls_tools);
}

function counted(name: 'depth' | 'call_depth', count: number): Readonly<Record<string, number>> {
  return count > 0 ? { [name]: count } : {};
}

function startedEvent(start: ExecutionStart & CommandMetadata): ExecutionEvent {
  const { primitive, name, spec_version, input, calls_tools, finishes_later, by, at } = start;
  const { depth = 0, call_depth: callDepth = 0, called_by: calledBy, trigger } = start;
  return {
    type: 'execution_started',
    primitive,
    name,
    spec_version,
    input,
    ...(calls_tools ? { calls_tools } : {}),
    ...(finishes_later === true ? { finishes_later } : {}),
    ...counted('depth', depth),
    ...counted('call_depth', callDepth),
    ...(calledBy === undefined ? {} : { called_by: calledBy }),
    ...(trigger === undefined ? {} : { trigger }),
    by,
    at,
  };
}

function startsAgain(start: ExecutionStart, state: RecordedExecution): boolean {
  return !isRunning(state) && !needsNoRun(state) && !mayHaveChangedSomething(state) && isSameRequest(state, start);
}

function decideCreateOnly(start: ExecutionStart & CommandMetadata, state: ExecutionState): Decision {
  return state === undefined || startsAgain(start, state)
    ? Result.succeed([startedEvent(start)])
    : Result.fail(runTaken);
}

function decideStart(start: ExecutionStart & CommandMetadata, state: ExecutionStreamState): Decision {
  const cancelled = cancelledBeforeItsStart(state);
  if (cancelled !== undefined) {
    return Result.fail(cancelled);
  }
  if (start.createOnly === true) {
    return decideCreateOnly(start, runOf(state));
  }
  return Result.flatMap(claimOf(state, start), (claim): Decision => {
    if (claim === 'answer') {
      return nothingToRecord;
    }
    return startedCallingToolsBefore(start, runOf(state))
      ? Result.fail(startedCallingTools)
      : Result.succeed([startedEvent(start)]);
  });
}

function ofTheStart({ execution, depth, callDepth, calledBy, trigger }: RecordedExecution) {
  const { primitive, name, spec_version } = execution;
  return {
    primitive,
    name,
    spec_version,
    ...counted('depth', depth),
    ...counted('call_depth', callDepth),
    ...(calledBy === undefined ? {} : { called_by: calledBy }),
    ...(trigger === undefined ? {} : { trigger }),
  };
}

function recordedOutcome(
  result: ExecutionOutcome,
  state: RecordedExecution,
  metadata: CommandMetadata,
): ExecutionEvent {
  return result.type === 'execution_deferred'
    ? { ...result, ...ofTheDefinition(state), ...metadata }
    : { ...result, ...ofTheStart(state), ...metadata };
}

function isDeferralAfterItsResult(result: ExecutionOutcome, state: RecordedExecution): boolean {
  return result.type === 'execution_deferred' && state.result !== undefined;
}

function outcomeOfAttempt(
  result: ExecutionOutcome | InterruptedAttempt,
  { cancel }: RecordedExecution,
): ExecutionOutcome {
  if (result.type !== 'execution_interrupted') {
    return result;
  }
  return cancel === undefined
    ? { type: 'execution_failed' }
    : { type: 'execution_rejected', rejection: { reason: 'cancelled', kind: cancel.kind, detail: cancel.reason } };
}

function decideFinish({ result, by, at }: ExecutionFinish & CommandMetadata, state: ExecutionState): Decision {
  if (state === undefined) {
    return nothingToRecord;
  }
  const outcome = outcomeOfAttempt(result, state);
  return needsNoRun(state) || isDeferralAfterItsResult(outcome, state)
    ? nothingToRecord
    : Result.succeed([recordedOutcome(outcome, state, { by, at })]);
}

export const endedWithAnotherResult = new Conflict({ detail: 'The run already ended with another result' });

export const answeredWithinDelivery = new Conflict({
  detail: 'The run was answered within its delivery, so that answer alone settles it',
});

function answeredOtherwise({ lastDelivery }: RecordedExecution, { result }: ExecutionSettlement): boolean {
  const answer = lastDelivery?.answer;
  return answer !== undefined && !succeedsWith(result, answer);
}

function settledAlready(state: RecordedExecution, settlement: ExecutionSettlement): Decision {
  return state.result !== undefined && settlementKeyOf(state.result) === settlementKeyOf(settlement.result)
    ? nothingToRecord
    : Result.fail(endedWithAnotherResult);
}

function decideSettlement(settlement: ExecutionSettlement, state: ExecutionState): Decision {
  if (state === undefined) {
    return Result.fail(noSuchRun);
  }
  if (!isRunning(state)) {
    return settledAlready(state, settlement);
  }
  if (answeredOtherwise(state, settlement)) {
    return Result.fail(answeredWithinDelivery);
  }
  const { result, by, at } = settlement;
  return takesSettlement(state)
    ? Result.succeed([recordedOutcome(result, state, { by, at })])
    : Result.fail(
        new Conflict({ detail: 'The run executes within the call that started it, so it cannot be settled' }),
      );
}

function cancelOfARun(cancel: ExecutionCancel, run: RecordedExecution): Decision {
  if (!isRunning(run)) {
    return Result.fail(endedBeforeCancelling);
  }
  if (!takesSettlement(run) && cancel.byItsCaller !== true) {
    return Result.fail(runsWithinItsCall);
  }
  const { kind, reason, by, at } = cancel;
  const { primitive, name, spec_version } = run.execution;
  return run.cancel === undefined
    ? Result.succeed([{ type: 'execution_cancel_requested', kind, reason, primitive, name, spec_version, by, at }])
    : nothingToRecord;
}

function decideCancel(cancel: ExecutionCancel, state: ExecutionStreamState): Decision {
  if (cancelBeforeStartOf(state) !== undefined) {
    return nothingToRecord;
  }
  const run = runOf(state);
  if (run !== undefined) {
    return cancelOfARun(cancel, run);
  }
  const { kind, reason, by, at } = cancel;
  return cancel.byItsCaller === true
    ? Result.succeed([{ type: 'execution_cancel_requested', kind, reason, by, at }])
    : Result.fail(noSuchRun);
}

export function decideOnExecution(command: ExecutionCommand, state: ExecutionStreamState): Decision {
  if (command.type === 'start') {
    return decideStart(command, state);
  }
  if (command.type === 'cancel') {
    return decideCancel(command, state);
  }
  const run = runOf(state);
  if (command.type === 'tool_call') {
    return decideToolCall(command, run);
  }
  if (command.type === 'outbound_call') {
    return decideOutboundCall(command, run);
  }
  return command.type === 'finish' ? decideFinish(command, run) : decideSettlement(command, run);
}
