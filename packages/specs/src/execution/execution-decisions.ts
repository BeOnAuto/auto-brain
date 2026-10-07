import { Conflict, NotFound, type Rejection } from '@beonauto/operations';
import { Equal, Result } from 'effect';

import type {
  CommandMetadata,
  ExecutionCancel,
  ExecutionCommand,
  ExecutionFinish,
  ExecutionOutcome,
  ExecutionRequest,
  ExecutionSettlement,
  ExecutionStart,
  ExecutionToolCall,
} from './execution-commands.ts';
import type { ExecutionEvent } from './execution-events.ts';
import {
  awaitsSettlement,
  hasFinalResult,
  isRunning,
  mayHaveChangedSomething,
  takesSettlement,
  type ExecutionState,
  type RecordedExecution,
} from './execution-state.ts';
import { settlementKeyOf } from './settlement-keys.ts';

type Decision = Result.Result<readonly ExecutionEvent[], Rejection<'not_found' | 'conflict'>>;

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

const runEnded = new Conflict({ detail: 'The run has ended, so it records no more of its work' });

const noSuchRun = new NotFound({ detail: 'There is no such run in this brain' });

export const runTaken = new Conflict({
  detail: 'A run under this id is going or has ended with a result, so this start records nothing',
  kind: 'taken',
});

export const endedBeforeCancelling = new Conflict({
  detail: 'The run has already ended, so there is nothing left to cancel',
});

export const runsWithinItsCall = new Conflict({
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

export function claimOf(state: ExecutionState, request: ExecutionRequest): Result.Result<Claim, Conflict> {
  if (state === undefined) {
    return Result.succeed('run');
  }
  if (!isSameRequest(state, request)) {
    return Result.fail(
      new Conflict({ detail: 'The run id belongs to a run of another definition or with another input' }),
    );
  }
  return claimOfRecorded(state);
}

function startedCallingToolsBefore(start: ExecutionStart, state: ExecutionState): boolean {
  return state !== undefined && isRunning(state) && (state.callsTools || start.calls_tools);
}

function counted(name: 'depth' | 'call_depth', count: number): Readonly<Record<string, number>> {
  return count > 0 ? { [name]: count } : {};
}

function startedEvent(start: ExecutionStart & CommandMetadata): ExecutionEvent {
  const { primitive, name, spec_version, input, calls_tools, finishes_later, by, at } = start;
  const { depth = 0, call_depth: callDepth = 0, called_by: calledBy } = start;
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

function decideStart(start: ExecutionStart & CommandMetadata, state: ExecutionState): Decision {
  if (start.createOnly === true) {
    return decideCreateOnly(start, state);
  }
  return Result.flatMap(claimOf(state, start), (claim): Decision => {
    if (claim === 'answer') {
      return nothingToRecord;
    }
    return startedCallingToolsBefore(start, state)
      ? Result.fail(startedCallingTools)
      : Result.succeed([startedEvent(start)]);
  });
}

function ofTheStart({ execution, depth, callDepth, calledBy }: RecordedExecution) {
  const { primitive, name, spec_version } = execution;
  return {
    primitive,
    name,
    spec_version,
    ...counted('depth', depth),
    ...counted('call_depth', callDepth),
    ...(calledBy === undefined ? {} : { called_by: calledBy }),
  };
}

function recordedOutcome(
  result: ExecutionOutcome,
  state: RecordedExecution,
  metadata: CommandMetadata,
): ExecutionEvent {
  return result.type === 'execution_deferred'
    ? { ...result, ...metadata }
    : { ...result, ...ofTheStart(state), ...metadata };
}

function isDeferralAfterItsResult(result: ExecutionOutcome, state: RecordedExecution): boolean {
  return result.type === 'execution_deferred' && state.result !== undefined;
}

function decideFinish({ result, by, at }: ExecutionFinish & CommandMetadata, state: ExecutionState): Decision {
  return state === undefined || needsNoRun(state) || isDeferralAfterItsResult(result, state)
    ? nothingToRecord
    : Result.succeed([recordedOutcome(result, state, { by, at })]);
}

function nextCallOf(state: RecordedExecution, number: number | undefined): Result.Result<number, Conflict> {
  const next = state.lastCall + 1;
  return number === undefined || number === next
    ? Result.succeed(next)
    : Result.fail(
        new Conflict({
          detail: `The run records its calls in order, and call ${number} is not its next call, ${next}; another attempt recorded it first`,
        }),
      );
}

function decideToolCall({ fact, by, at }: ExecutionToolCall & CommandMetadata, state: ExecutionState): Decision {
  if (state === undefined || !isRunning(state)) {
    return Result.fail(runEnded);
  }
  if (fact.type === 'tool_call_answered') {
    return Result.succeed([{ ...fact, by, at }]);
  }
  return Result.map(nextCallOf(state, fact.number), (number) => [{ ...fact, number, by, at }]);
}

export const endedWithAnotherResult = new Conflict({ detail: 'The run already ended with another result' });

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
  const { result, by, at } = settlement;
  return takesSettlement(state)
    ? Result.succeed([recordedOutcome(result, state, { by, at })])
    : Result.fail(
        new Conflict({ detail: 'The run executes within the call that started it, so it cannot be settled' }),
      );
}

function decideCancel({ kind, reason, by, at }: ExecutionCancel, state: ExecutionState): Decision {
  if (state === undefined) {
    return Result.fail(noSuchRun);
  }
  if (!isRunning(state)) {
    return Result.fail(endedBeforeCancelling);
  }
  if (!takesSettlement(state)) {
    return Result.fail(runsWithinItsCall);
  }
  const { primitive, name, spec_version } = state.execution;
  return state.cancelRequested
    ? nothingToRecord
    : Result.succeed([{ type: 'execution_cancel_requested', kind, reason, primitive, name, spec_version, by, at }]);
}

export function decideOnExecution(command: ExecutionCommand, state: ExecutionState): Decision {
  if (command.type === 'start') {
    return decideStart(command, state);
  }
  if (command.type === 'tool_call') {
    return decideToolCall(command, state);
  }
  if (command.type === 'cancel') {
    return decideCancel(command, state);
  }
  return command.type === 'finish' ? decideFinish(command, state) : decideSettlement(command, state);
}
