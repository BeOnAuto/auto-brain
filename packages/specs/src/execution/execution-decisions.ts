import { Conflict, NotFound, type Rejection } from '@beonauto/operations';
import { Equal, Result } from 'effect';

import type {
  CommandMetadata,
  ExecutionCommand,
  ExecutionFinish,
  ExecutionRequest,
  ExecutionSettlement,
  ExecutionStart,
} from './execution-commands.ts';
import type { ExecutionEvent } from './execution-events.ts';
import { awaitsSettlement, hasFinalResult, type ExecutionState, type RecordedExecution } from './execution-state.ts';

type Decision = Result.Result<readonly ExecutionEvent[], Rejection<'not_found' | 'conflict'>>;

export type Claim = 'run' | 'answer';

const nothingToRecord: Decision = Result.succeed([]);

function isSameRequest({ input, execution }: RecordedExecution, request: ExecutionRequest): boolean {
  return (
    execution.primitive === request.primitive && execution.name === request.name && Equal.equals(input, request.input)
  );
}

function needsNoRun(state: RecordedExecution): boolean {
  return hasFinalResult(state) || awaitsSettlement(state);
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
  return Result.succeed(needsNoRun(state) ? 'answer' : 'run');
}

function decideStart(start: ExecutionStart & CommandMetadata, state: ExecutionState): Decision {
  const { primitive, name, input, spec_version, by, at } = start;
  return Result.map(claimOf(state, start), (claim): readonly ExecutionEvent[] =>
    claim === 'run' ? [{ type: 'execution_started', primitive, name, spec_version, input, by, at }] : [],
  );
}

function decideFinish({ result, by, at }: ExecutionFinish & CommandMetadata, state: ExecutionState): Decision {
  return state === undefined || needsNoRun(state) ? nothingToRecord : Result.succeed([{ ...result, by, at }]);
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
  return command.type === 'finish' ? decideFinish(command, state) : decideSettlement(command, state);
}
