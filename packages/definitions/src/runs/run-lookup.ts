import { Conflict, InvalidInput, NotFound, RunCancelled, RunUnanswered, Unavailable } from '@beonauto/operations';
import { Effect } from 'effect';

import { startedRunOf, type RunStreamState, type RecordedRunState } from './run-state.ts';
import type { Run, RunDetail, RunRejection } from './run.ts';

export function noRunCalled(id: string): NotFound {
  return new NotFound({ detail: `There is no run ${id} in this brain` });
}

function recorded(id: string, stream: RunStreamState): Effect.Effect<RecordedRunState, NotFound> {
  const state = startedRunOf(stream);
  return state === undefined ? Effect.fail(noRunCalled(id)) : Effect.succeed(state);
}

export function runOf(id: string, state: RunStreamState): Effect.Effect<Run, NotFound> {
  return recorded(id, state).pipe(Effect.map(({ run }) => ({ run_id: id, ...run })));
}

function detailOf(id: string, { run, record }: RecordedRunState): RunDetail {
  return record === undefined ? { run_id: id, ...run } : { run_id: id, ...run, record };
}

export function runDetailOf(id: string, state: RunStreamState): Effect.Effect<RunDetail, NotFound> {
  return recorded(id, state).pipe(Effect.map((run) => detailOf(id, run)));
}

type ReplayedRejection = InvalidInput | Unavailable | Conflict | RunCancelled | RunUnanswered;

function replayed(rejection: RunRejection): ReplayedRejection {
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

function answerWith(run: Run): Effect.Effect<Run, ReplayedRejection> {
  return run.rejection === undefined ? Effect.succeed(run) : Effect.fail(replayed(run.rejection));
}

export function answerOf(id: string, state: RunStreamState): Effect.Effect<Run, NotFound | ReplayedRejection> {
  return runOf(id, state).pipe(Effect.flatMap(answerWith));
}
