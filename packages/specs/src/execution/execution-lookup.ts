import { Conflict, InvalidInput, NotFound, Unavailable } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ExecutionState } from './execution-state.ts';
import type { Execution, ExecutionRejection } from './execution.ts';

export function executionOf(id: string, state: ExecutionState): Effect.Effect<Execution, NotFound> {
  return state === undefined
    ? Effect.fail(new NotFound({ detail: `There is no execution ${id} in this brain` }))
    : Effect.succeed({ execution_id: id, ...state.execution });
}

type ReplayedRejection = InvalidInput | Unavailable | Conflict;

function replayed(rejection: ExecutionRejection): ReplayedRejection {
  if (rejection.reason === 'invalid_input') {
    return new InvalidInput({ detail: rejection.detail, issues: rejection.issues });
  }
  return rejection.reason === 'unavailable'
    ? new Unavailable({ detail: rejection.detail })
    : new Conflict({ detail: rejection.detail });
}

function answerWith(execution: Execution): Effect.Effect<Execution, ReplayedRejection> {
  return execution.rejection === undefined ? Effect.succeed(execution) : Effect.fail(replayed(execution.rejection));
}

export function answerOf(id: string, state: ExecutionState): Effect.Effect<Execution, NotFound | ReplayedRejection> {
  return executionOf(id, state).pipe(Effect.flatMap(answerWith));
}
