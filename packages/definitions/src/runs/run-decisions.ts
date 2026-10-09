import { Conflict, NotFound, RunCancelled, type Rejection } from '@beonauto/operations';
import { Equal, Result } from 'effect';

import { decideOutboundCall, decideReply, decideToolCall, ofTheDefinition } from '../run-work/work-decisions.ts';
import type {
  CommandMetadata,
  RunCancel,
  RunCommand,
  RunFinish,
  RunOutcome,
  RunRequest,
  RunSettlement,
  RunStart,
  InterruptedAttempt,
} from './run-commands.ts';
import type { RunEvent } from './run-events.ts';
import {
  awaitsSettlement,
  cancelBeforeStartOf,
  hasFinalResult,
  isRunning,
  mayHaveChangedSomething,
  startedRunOf,
  takesSettlement,
  type RunState,
  type RunStreamState,
  type RecordedRunState,
} from './run-state.ts';
import { settlementKeyOf, succeedsWith } from './settlement-keys.ts';

type Decision = Result.Result<readonly RunEvent[], Rejection<'not_found' | 'conflict' | 'cancelled'>>;

export type Claim = 'run' | 'answer';

const nothingToRecord: Decision = Result.succeed([]);

const toolsWereCalled = new Conflict({
  detail:
    'The run called tools and did not succeed, so it is not run again under its id, since a tool may have changed something; start a new run with another run id, and read with get_run_history what it called',
  kind: 'tools_called',
});

const startedCallingTools = new Conflict({
  detail:
    'The run has started and its definition calls tools, so it is not run again under its id: it may still be in progress, or have stopped without recording how it ended, and its tools may have changed something; start a new run with another run id, and read with get_run_history what it has called so far',
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

function isSameRequest({ input, run }: RecordedRunState, request: RunRequest): boolean {
  return run.type === request.definition_type && run.name === request.name && Equal.equals(input, request.input);
}

function needsNoRun(state: RecordedRunState): boolean {
  return hasFinalResult(state) || awaitsSettlement(state);
}

function claimOfRecorded(state: RecordedRunState): Result.Result<Claim, Conflict> {
  if (needsNoRun(state)) {
    return Result.succeed('answer');
  }
  return mayHaveChangedSomething(state) ? Result.fail(toolsWereCalled) : Result.succeed('run');
}

function cancelledBeforeItsStart(state: RunStreamState): RunCancelled | undefined {
  const cancel = cancelBeforeStartOf(state);
  return cancel === undefined ? undefined : new RunCancelled({ detail: cancel.reason, kind: cancel.kind });
}

export function claimOf(state: RunStreamState, request: RunRequest): Result.Result<Claim, Conflict | RunCancelled> {
  const cancelled = cancelledBeforeItsStart(state);
  if (cancelled !== undefined) {
    return Result.fail(cancelled);
  }
  const run = startedRunOf(state);
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

function startedCallingToolsBefore(start: RunStart, state: RunState): boolean {
  return state !== undefined && isRunning(state) && (state.callsTools || start.calls_tools);
}

function counted(name: 'depth' | 'call_depth', count: number): Readonly<Record<string, number>> {
  return count > 0 ? { [name]: count } : {};
}

function startedEvent(start: RunStart & CommandMetadata): RunEvent {
  const { definition_type: type, name, definition_version, input, calls_tools, finishes_later, by, at } = start;
  const { depth = 0, call_depth: callDepth = 0, called_by: calledBy, trigger } = start;
  return {
    type: 'run_started',
    definition_type: type,
    name,
    definition_version,
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

function startsAgain(start: RunStart, state: RecordedRunState): boolean {
  return !isRunning(state) && !needsNoRun(state) && !mayHaveChangedSomething(state) && isSameRequest(state, start);
}

function decideCreateOnly(start: RunStart & CommandMetadata, state: RunState): Decision {
  return state === undefined || startsAgain(start, state)
    ? Result.succeed([startedEvent(start)])
    : Result.fail(runTaken);
}

function decideStart(start: RunStart & CommandMetadata, state: RunStreamState): Decision {
  const cancelled = cancelledBeforeItsStart(state);
  if (cancelled !== undefined) {
    return Result.fail(cancelled);
  }
  if (start.createOnly === true) {
    return decideCreateOnly(start, startedRunOf(state));
  }
  return Result.flatMap(claimOf(state, start), (claim): Decision => {
    if (claim === 'answer') {
      return nothingToRecord;
    }
    return startedCallingToolsBefore(start, startedRunOf(state))
      ? Result.fail(startedCallingTools)
      : Result.succeed([startedEvent(start)]);
  });
}

function ofTheStart({ run, depth, callDepth, calledBy, trigger }: RecordedRunState) {
  const { type, name, definition_version } = run;
  return {
    definition_type: type,
    name,
    definition_version,
    ...counted('depth', depth),
    ...counted('call_depth', callDepth),
    ...(calledBy === undefined ? {} : { called_by: calledBy }),
    ...(trigger === undefined ? {} : { trigger }),
  };
}

function recordedOutcome(result: RunOutcome, state: RecordedRunState, metadata: CommandMetadata): RunEvent {
  return result.type === 'run_deferred'
    ? { ...result, ...ofTheDefinition(state), ...metadata }
    : { ...result, ...ofTheStart(state), ...metadata };
}

function isDeferralAfterItsResult(result: RunOutcome, state: RecordedRunState): boolean {
  return result.type === 'run_deferred' && state.result !== undefined;
}

function outcomeOfAttempt(result: RunOutcome | InterruptedAttempt, { cancel }: RecordedRunState): RunOutcome {
  if (result.type !== 'run_interrupted') {
    return result;
  }
  return cancel === undefined
    ? { type: 'run_failed' }
    : { type: 'run_rejected', rejection: { reason: 'cancelled', kind: cancel.kind, detail: cancel.reason } };
}

function decideFinish({ result, by, at }: RunFinish & CommandMetadata, state: RunState): Decision {
  if (state === undefined) {
    return nothingToRecord;
  }
  const outcome = outcomeOfAttempt(result, state);
  return needsNoRun(state) || isDeferralAfterItsResult(outcome, state)
    ? nothingToRecord
    : Result.succeed([recordedOutcome(outcome, state, { by, at })]);
}

export const endedWithAnotherResult = new Conflict({ detail: 'The run already ended with another result' });

export const answeredByAReply = new Conflict({
  detail: 'The run was answered by a reply, so that answer alone settles it',
});

function answeredOtherwise({ broughtAnswer }: RecordedRunState, { result }: RunSettlement): boolean {
  return broughtAnswer !== null && !succeedsWith(result, broughtAnswer.answer);
}

function settledAlready(state: RecordedRunState, settlement: RunSettlement): Decision {
  return state.result !== undefined && settlementKeyOf(state.result) === settlementKeyOf(settlement.result)
    ? nothingToRecord
    : Result.fail(endedWithAnotherResult);
}

function decideSettlement(settlement: RunSettlement, state: RunState): Decision {
  if (state === undefined) {
    return Result.fail(noSuchRun);
  }
  if (!isRunning(state)) {
    return settledAlready(state, settlement);
  }
  if (answeredOtherwise(state, settlement)) {
    return Result.fail(answeredByAReply);
  }
  const { result, by, at } = settlement;
  return takesSettlement(state)
    ? Result.succeed([recordedOutcome(result, state, { by, at })])
    : Result.fail(
        new Conflict({ detail: 'The run executes within the call that started it, so it cannot be settled' }),
      );
}

function cancelOfARun(cancel: RunCancel, run: RecordedRunState): Decision {
  if (!isRunning(run)) {
    return Result.fail(endedBeforeCancelling);
  }
  if (!takesSettlement(run) && cancel.byItsCaller !== true) {
    return Result.fail(runsWithinItsCall);
  }
  const { kind, reason, by, at } = cancel;
  const { type, name, definition_version } = run.run;
  return run.cancel === undefined
    ? Result.succeed([
        { type: 'run_cancel_requested', kind, reason, definition_type: type, name, definition_version, by, at },
      ])
    : nothingToRecord;
}

function decideCancel(cancel: RunCancel, state: RunStreamState): Decision {
  if (cancelBeforeStartOf(state) !== undefined) {
    return nothingToRecord;
  }
  const run = startedRunOf(state);
  if (run !== undefined) {
    return cancelOfARun(cancel, run);
  }
  const { kind, reason, by, at } = cancel;
  return cancel.byItsCaller === true
    ? Result.succeed([{ type: 'run_cancel_requested', kind, reason, by, at }])
    : Result.fail(noSuchRun);
}

export function decideOnRun(command: RunCommand, state: RunStreamState): Decision {
  if (command.type === 'start') {
    return decideStart(command, state);
  }
  if (command.type === 'cancel') {
    return decideCancel(command, state);
  }
  const run = startedRunOf(state);
  if (command.type === 'tool_call') {
    return decideToolCall(command, run);
  }
  if (command.type === 'outbound_call') {
    return decideOutboundCall(command, run);
  }
  if (command.type === 'reply') {
    return decideReply(command, run);
  }
  return command.type === 'finish' ? decideFinish(command, run) : decideSettlement(command, run);
}
