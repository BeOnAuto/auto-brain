import { Conflict, InvalidInput, NotFound, RunCancelled, Unavailable } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ExecutionState, RecordedExecution } from './execution-state.ts';
import type { Run, RunDetail, ExecutionRejection } from './execution.ts';

function recorded(id: string, state: ExecutionState): Effect.Effect<RecordedExecution, NotFound> {
  return state === undefined
    ? Effect.fail(new NotFound({ detail: `There is no run ${id} in this brain` }))
    : Effect.succeed(state);
}

export function executionOf(id: string, state: ExecutionState): Effect.Effect<Run, NotFound> {
  return recorded(id, state).pipe(Effect.map(({ execution }) => ({ execution_id: id, ...execution })));
}

function detailOf(id: string, { execution, record }: RecordedExecution): RunDetail {
  return record === undefined ? { execution_id: id, ...execution } : { execution_id: id, ...execution, record };
}

export function executionDetailOf(id: string, state: ExecutionState): Effect.Effect<RunDetail, NotFound> {
  return recorded(id, state).pipe(Effect.map((execution) => detailOf(id, execution)));
}

type ReplayedRejection = InvalidInput | Unavailable | Conflict | RunCancelled;

function replayed(rejection: ExecutionRejection): ReplayedRejection {
  if (rejection.reason === 'invalid_input') {
    return new InvalidInput({ detail: rejection.detail, issues: rejection.issues });
  }
  if (rejection.reason === 'unavailable') {
    const { detail, kind, because } = rejection;
    return new Unavailable({
      detail,
      ...(kind === undefined ? {} : { kind }),
      ...(because === undefined ? {} : { because }),
    });
  }
  if (rejection.reason === 'cancelled') {
    return new RunCancelled({ detail: rejection.detail, kind: rejection.kind });
  }
  return new Conflict({ detail: rejection.detail, kind: rejection.kind ?? 'unworkable' });
}

function answerWith(execution: Run): Effect.Effect<Run, ReplayedRejection> {
  return execution.rejection === undefined ? Effect.succeed(execution) : Effect.fail(replayed(execution.rejection));
}

export function answerOf(id: string, state: ExecutionState): Effect.Effect<Run, NotFound | ReplayedRejection> {
  return executionOf(id, state).pipe(Effect.flatMap(answerWith));
}
