import { Unavailable } from '@beonauto/operations';
import type { CheckIssue, CheckJob, CheckOutcome, ProgramPool, Stopped } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';

export const checkWorker = new URL('./check-worker.ts', import.meta.url);

export const checkDeadlineMs = 2000;

const stoppedBecause: Readonly<Record<Stopped, (deadlineMs: number) => string>> = {
  deadline: (deadlineMs) =>
    `The check of the document did not answer within the ${deadlineMs} ms a save allows it, and was stopped; try again`,
  busy: (deadlineMs) =>
    `No checker was free within the ${deadlineMs} ms a save allows its check, since this server checks one document at a time; try again`,
  memory: () => 'The check of the document took more memory than its worker may use, and was stopped; try again',
  cancelled: () => 'The save was stopped before its check ended',
  closing: () => 'The server is stopping',
};

function issuesOf(outcome: CheckOutcome, deadlineMs: number): Effect.Effect<readonly CheckIssue[], Unavailable> {
  if (outcome.ran === 'checked') {
    return Effect.succeed(outcome.issues);
  }
  if (outcome.ran === 'stopped') {
    return Effect.fail(new Unavailable({ detail: stoppedBecause[outcome.because](deadlineMs) }));
  }
  return Effect.die(
    new Error(outcome.ran === 'crashed' ? outcome.detail : 'The check worker could not read the check it was given'),
  );
}

export function checkedAtSave(
  pool: ProgramPool,
  job: CheckJob,
  deadlineMs: number = checkDeadlineMs,
): Effect.Effect<readonly CheckIssue[], Unavailable> {
  return Effect.promise((signal) => pool.check({ ...job, deadlineMs, worker: checkWorker }, signal)).pipe(
    Effect.flatMap((outcome) => issuesOf(outcome, deadlineMs)),
  );
}
