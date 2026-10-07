import { Conflict, InvalidInput, NotFound, RunCancelled, RunUnanswered, Unavailable } from '@beonauto/operations';
import { Effect } from 'effect';

import { runOf, type ExecutionStreamState, type RecordedExecution } from './execution-state.ts';
import type { Run, RunDetail, ExecutionRejection } from './execution.ts';

export function noRunCalled(id: string): NotFound {
  return new NotFound({ detail: `There is no run ${id} in this brain` });
}

function recorded(id: string, stream: ExecutionStreamState): Effect.Effect<RecordedExecution, NotFound> {
  const state = runOf(stream);
  return state === undefined ? Effect.fail(noRunCalled(id)) : Effect.succeed(state);
}

export function executionOf(id: string, state: ExecutionStreamState): Effect.Effect<Run, NotFound> {
  return recorded(id, state).pipe(Effect.map(({ execution }) => ({ execution_id: id, ...execution })));
}

function detailOf(id: string, { execution, record }: RecordedExecution): RunDetail {
  return record === undefined ? { execution_id: id, ...execution } : { execution_id: id, ...execution, record };
}

export function executionDetailOf(id: string, state: ExecutionStreamState): Effect.Effect<RunDetail, NotFound> {
  return recorded(id, state).pipe(Effect.map((execution) => detailOf(id, execution)));
}

type ReplayedRejection = InvalidInput | Unavailable | Conflict | RunCancelled | RunUnanswered;

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
  if (rejection.reason === 'unanswered') {
    return new RunUnanswered({ detail: rejection.detail, kind: rejection.kind });
  }
  const { detail, kind } = rejection;
  return new Conflict(kind === undefined ? { detail } : { detail, kind });
}

function answerWith(execution: Run): Effect.Effect<Run, ReplayedRejection> {
  return execution.rejection === undefined ? Effect.succeed(execution) : Effect.fail(replayed(execution.rejection));
}

export function answerOf(id: string, state: ExecutionStreamState): Effect.Effect<Run, NotFound | ReplayedRejection> {
  return executionOf(id, state).pipe(Effect.flatMap(answerWith));
}
