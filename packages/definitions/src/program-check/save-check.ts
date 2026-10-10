import { InvalidInput, Unavailable } from '@beonauto/operations';
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

const stoppedBecause: Readonly<Record<Exclude<Stopped, 'deadline'>, string>> = {
  busy: 'No checker was ready in time for this save, since this server checks one document at a time with one checker; try again',
  memory: 'The check of the document took more memory than its worker may use, and was stopped; try again',
  cancelled: 'The save was stopped before its check ended',
  closing: 'The server is stopping',
};

function tooLongToCheck(deadlineMs: number): string {
  return `The document takes longer to check than the ${deadlineMs} ms a save allows its check, so saving it again would not help; simplify its types or split its program`;
}

const notStripped: StrippedSources = { expressions: [] };

const warming: CheckJob = { schemas: {}, expressions: [{ source: 'true', names: [] }] };

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
): Effect.Effect<CheckedDocument, InvalidInput | Unavailable> {
  if (outcome.ran === 'checked') {
    return Effect.succeed(checkedOf(job, outcome.issues, outcome.stripped));
  }
  if (outcome.ran === 'stopped') {
    const detail = tooLongToCheck(deadlineMs);
    return outcome.because === 'deadline'
      ? Effect.fail(new InvalidInput({ detail, issues: [{ pointer: '', detail }] }))
      : Effect.fail(new Unavailable({ detail: stoppedBecause[outcome.because] }));
  }
  return Effect.die(
    new Error(outcome.ran === 'crashed' ? outcome.detail : 'The check worker could not read the check it was given'),
  );
}

export function checkedAtSave(
  pool: ProgramPool,
  job: CheckJob,
  deadlineMs: number = checkDeadlineMs,
): Effect.Effect<CheckedDocument, InvalidInput | Unavailable> {
  return Effect.promise((signal) => pool.check({ ...job, deadlineMs, worker: checkWorker }, signal)).pipe(
    Effect.flatMap((outcome) => issuesOf(job, outcome, deadlineMs)),
  );
}

export function warmedChecks(pool: ProgramPool): Promise<CheckOutcome> {
  return pool.check({ ...warming, deadlineMs: checkDeadlineMs, worker: checkWorker });
}
