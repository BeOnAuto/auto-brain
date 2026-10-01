import { Conflict } from '@beonauto/operations';
import { Equal, Result } from 'effect';

import type {
  CommandMetadata,
  ExecutionCommand,
  ExecutionFinish,
  ExecutionRequest,
  ExecutionStart,
} from './execution-commands.ts';
import type { ExecutionEvent } from './execution-events.ts';
import { hasFinalResult, type ExecutionState, type RecordedExecution } from './execution-state.ts';

type Decision = Result.Result<readonly ExecutionEvent[], Conflict>;

export type Claim = 'run' | 'answer';

function isSameRequest({ input, execution }: RecordedExecution, request: ExecutionRequest): boolean {
  return (
    execution.primitive === request.primitive && execution.name === request.name && Equal.equals(input, request.input)
  );
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
  return Result.succeed(hasFinalResult(state) ? 'answer' : 'run');
}

function decideStart(start: ExecutionStart & CommandMetadata, state: ExecutionState): Decision {
  const { primitive, name, input, spec_version, by, at } = start;
  return Result.map(claimOf(state, start), (claim): readonly ExecutionEvent[] =>
    claim === 'run' ? [{ type: 'execution_started', primitive, name, spec_version, input, by, at }] : [],
  );
}

function decideFinish({ result, by, at }: ExecutionFinish & CommandMetadata, state: ExecutionState): Decision {
  return Result.succeed(state === undefined || hasFinalResult(state) ? [] : [{ ...result, by, at }]);
}

export function decideOnExecution(command: ExecutionCommand, state: ExecutionState): Decision {
  return command.type === 'start' ? decideStart(command, state) : decideFinish(command, state);
}
