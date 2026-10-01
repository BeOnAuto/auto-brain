import { InvalidInput, NotFound, Unavailable } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ExecutionState } from './execution-state.ts';
import type { Execution, ExecutionRejection } from './execution.ts';

export function executionOf(id: string, state: ExecutionState): Effect.Effect<Execution, NotFound> {
  return state === undefined
    ? Effect.fail(new NotFound({ detail: `There is no execution ${id} in this brain` }))
    : Effect.succeed({ execution_id: id, ...state.execution });
}

function replayed(rejection: ExecutionRejection): InvalidInput | Unavailable {
  return rejection.reason === 'invalid_input'
    ? new InvalidInput({ detail: rejection.detail, issues: rejection.issues })
    : new Unavailable({ detail: rejection.detail });
}

function answerWith(execution: Execution): Effect.Effect<Execution, InvalidInput | Unavailable> {
  return execution.rejection === undefined ? Effect.succeed(execution) : Effect.fail(replayed(execution.rejection));
}

export function answerOf(
  id: string,
  state: ExecutionState,
): Effect.Effect<Execution, NotFound | InvalidInput | Unavailable> {
  return executionOf(id, state).pipe(Effect.flatMap(answerWith));
}
