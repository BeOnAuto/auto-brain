import { Unavailable } from '@beonauto/operations';
import type {
  CheckIssue,
  CheckJob,
  CheckOutcome,
  ProgramPool,
  Stopped,
  StrippedSources,
} from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';

import { changedExpressions, type StrippedForms } from '../capability/stripped-forms.ts';

export const checkWorker = new URL('./check-worker.ts', import.meta.url);

export const checkDeadlineMs = 2000;

export type CheckedDocument = { readonly issues: readonly CheckIssue[] } | { readonly stripped: StrippedForms };

const stoppedBecause: Readonly<Record<Stopped, (deadlineMs: number) => string>> = {
  deadline: (deadlineMs) =>
    `The check of the document did not answer within the ${deadlineMs} ms a save allows it, and was stopped; try again`,
  busy: (deadlineMs) =>
    `No checker was free within the ${deadlineMs} ms a save allows its check, since this server checks one document at a time; try again`,
  memory: () => 'The check of the document took more memory than its worker may use, and was stopped; try again',
  cancelled: () => 'The save was stopped before its check ended',
  closing: () => 'The server is stopping',
};

const notStripped: StrippedSources = { expressions: [] };

function formsOf(job: CheckJob, { module, expressions }: StrippedSources): StrippedForms {
  return {
    ...(module === undefined ? {} : { module }),
    ...changedExpressions(
      job.expressions.map(({ source }) => source),
      expressions,
    ),
  };
}

function checkedOf(job: CheckJob, issues: readonly CheckIssue[], stripped = notStripped): CheckedDocument {
  return issues.length === 0 ? { stripped: formsOf(job, stripped) } : { issues };
}

function issuesOf(
  job: CheckJob,
  outcome: CheckOutcome,
  deadlineMs: number,
): Effect.Effect<CheckedDocument, Unavailable> {
  if (outcome.ran === 'checked') {
    return Effect.succeed(checkedOf(job, outcome.issues, outcome.stripped));
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
): Effect.Effect<CheckedDocument, Unavailable> {
  return Effect.promise((signal) => pool.check({ ...job, deadlineMs, worker: checkWorker }, signal)).pipe(
    Effect.flatMap((outcome) => issuesOf(job, outcome, deadlineMs)),
  );
}
