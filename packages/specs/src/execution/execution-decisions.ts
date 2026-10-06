import { Conflict, NotFound, type Rejection } from '@beonauto/operations';
import { Equal, Result } from 'effect';

import type {
  CommandMetadata,
  ExecutionCommand,
  ExecutionFinish,
  ExecutionRequest,
  ExecutionSettlement,
  ExecutionStart,
  ExecutionToolCall,
} from './execution-commands.ts';
import type { ExecutionEvent } from './execution-events.ts';
import {
  awaitsSettlement,
  calledTools,
  hasFinalResult,
  isRunning,
  type ExecutionState,
  type RecordedExecution,
} from './execution-state.ts';

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

const runFinished = new Conflict({ detail: 'The run has finished, so it records no more tool calls' });

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
  return calledTools(state) ? Result.fail(toolsWereCalled) : Result.succeed('run');
}

export function claimOf(state: ExecutionState, request: ExecutionRequest): Result.Result<Claim, Conflict> {
  if (state === undefined) {
    return Result.succeed('run');
  }
  if (!isSameRequest(state, request)) {
    return Result.fail(
      new Conflict({ detail: 'The execution id belongs to an execution of another spec or with another input' }),
    );
  }
  return claimOfRecorded(state);
}

function startedCallingToolsBefore(start: ExecutionStart, state: ExecutionState): boolean {
  return state !== undefined && isRunning(state) && (state.callsTools || start.calls_tools);
}

function startedEvent(start: ExecutionStart & CommandMetadata): ExecutionEvent {
  const { primitive, name, input, spec_version, calls_tools, by, at } = start;
  return {
    type: 'execution_started',
    primitive,
    name,
    spec_version,
    input,
    ...(calls_tools ? { calls_tools } : {}),
    by,
    at,
  };
}

function decideStart(start: ExecutionStart & CommandMetadata, state: ExecutionState): Decision {
  return Result.flatMap(claimOf(state, start), (claim): Decision => {
    if (claim === 'answer') {
      return nothingToRecord;
    }
    return startedCallingToolsBefore(start, state)
      ? Result.fail(startedCallingTools)
      : Result.succeed([startedEvent(start)]);
  });
}

function decideFinish({ result, by, at }: ExecutionFinish & CommandMetadata, state: ExecutionState): Decision {
  return state === undefined || needsNoRun(state) ? nothingToRecord : Result.succeed([{ ...result, by, at }]);
}

function decideToolCall({ fact, by, at }: ExecutionToolCall & CommandMetadata, state: ExecutionState): Decision {
  return state !== undefined && isRunning(state) && !state.finishesLater
    ? Result.succeed([{ ...fact, by, at }])
    : Result.fail(runFinished);
}

function unsettleable({ result }: RecordedExecution): Conflict {
  return new Conflict({
    detail:
      result === undefined
        ? 'The execution runs within the call that started it, so it cannot be settled'
        : 'The execution already ended with another result',
  });
}

function decideSettlement({ result, at }: ExecutionSettlement, state: ExecutionState): Decision {
  if (state === undefined) {
    return Result.fail(new NotFound({ detail: 'There is no such execution in this brain' }));
  }
  if (Equal.equals(state.result, result)) {
    return nothingToRecord;
  }
  return awaitsSettlement(state)
    ? Result.succeed([{ ...result, by: state.execution.started_by, at }])
    : Result.fail(unsettleable(state));
}

export function decideOnExecution(command: ExecutionCommand, state: ExecutionState): Decision {
  if (command.type === 'start') {
    return decideStart(command, state);
  }
  if (command.type === 'tool_call') {
    return decideToolCall(command, state);
  }
  return command.type === 'finish' ? decideFinish(command, state) : decideSettlement(command, state);
}
