import { Conflict, Unavailable } from '@beonauto/operations';
import type { CompiledSchema } from '@beonauto/specs/document';
import { issuesDetail } from '@beonauto/specs/json-schema';
import {
  jsonBytesOf,
  lineOf,
  type PoolOutcome,
  type ProgramSpan,
  type Stopped,
  workerStackMegabytes,
} from '@beonauto/workflow-engine/dsl';
import { Effect, Result, type Schema } from 'effect';

import type { RecallAnswer } from '../document/recall-document.ts';
import { mostOutputBytes, recallBounds } from './recall-bounds.ts';

export interface Answered {
  readonly output: Schema.Json;
  readonly work: number;
  readonly milliseconds: number;
  readonly bytes: number;
}

export interface AnswerFacts {
  readonly answer: RecallAnswer;
  readonly workers: number;
  readonly heapMegabytes: number;
  readonly deadlineMs: number;
}

type Ending = Effect.Effect<Answered, Conflict | Unavailable>;

type Exhausted = Extract<PoolOutcome, { readonly ran: 'exhausted' }>;

type Unworkable = Extract<
  PoolOutcome,
  { readonly ran: 'oversized' | 'mismatched' | 'unanswered' | 'unfit' | 'refused' }
>;

const mostIssuesInADetail = 3;

function unworkable(detail: string): Ending {
  return Effect.fail(new Conflict({ detail, kind: 'unworkable' }));
}

function lineAt({ source, line }: RecallAnswer, span: ProgramSpan): number {
  return line + lineOf(source, span.start) - 1;
}

const stoppedBecause: Readonly<Record<Stopped, (facts: AnswerFacts) => string>> = {
  deadline: ({ deadlineMs }) =>
    `The answer took longer than the ${deadlineMs} ms a recall function may run, and was stopped`,
  memory: ({ heapMegabytes }) =>
    `The answer took more than the ${heapMegabytes} MiB of memory a recall function may use, and was stopped`,
  busy: ({ workers, deadlineMs }) =>
    `No worker was free to answer within ${deadlineMs} ms; this server runs ${workers} programs at once`,
  cancelled: () => 'The run was stopped before it ended',
  closing: () => 'The server is stopping',
};

function exhaustedWith({ limit, issue, work }: Exhausted, facts: AnswerFacts): Ending {
  const line = lineAt(facts.answer, issue.span);
  if (limit === 'deadline') {
    return Effect.fail(new Unavailable({ detail: stoppedBecause.deadline(facts) }));
  }
  if (limit === 'depth') {
    return unworkable(
      `The answer recursed deeper than the ${recallBounds.mostEvaluationDepth} levels of evaluation a run may nest, on line ${line}`,
    );
  }
  if (limit === 'stack') {
    return unworkable(`The answer went deeper than the ${workerStackMegabytes} MiB stack of a run allows`);
  }
  return limit === 'work'
    ? unworkable(
        `The answer did more than the ${recallBounds.mostWork} units of work a run may do, on line ${line}, having done ${work}`,
      )
    : unworkable(
        `The answer built a value that nests deeper than the ${recallBounds.mostValueDepth} levels a value may, on line ${line}`,
      );
}

function unworkableWith(outcome: Unworkable): Ending {
  if (outcome.ran === 'refused') {
    return Effect.die(new Error('The worker refused an answer the definition was accepted with'));
  }
  if (outcome.ran === 'mismatched') {
    return unworkable(`The answer does not match the output schema: ${issuesDetail(outcome.issues, 'output')}`);
  }
  if (outcome.ran === 'oversized') {
    return unworkable(`The answer takes more than the ${mostOutputBytes} bytes as JSON a run can record`);
  }
  if (outcome.ran === 'unfit') {
    return unworkable('The answer gave a number JSON cannot carry, such as nan or infinite');
  }
  return unworkable(
    `The answer gave ${outcome.outputs === 0 ? 'no output' : 'more than one output'}; a recall function gives exactly one`,
  );
}

export function answerEndingOf(outcome: PoolOutcome, facts: AnswerFacts): Ending {
  if (outcome.ran === 'answered') {
    const { output, work, milliseconds, bytes } = outcome;
    return Effect.succeed({ output, work, milliseconds, bytes });
  }
  if (outcome.ran === 'raised') {
    return unworkable(
      `The answer raised an error on line ${lineAt(facts.answer, outcome.issue.span)}: ${outcome.issue.detail}`,
    );
  }
  if (outcome.ran === 'exhausted') {
    return exhaustedWith(outcome, facts);
  }
  if (outcome.ran === 'stopped') {
    return Effect.fail(new Unavailable({ detail: stoppedBecause[outcome.because](facts) }));
  }
  return outcome.ran === 'crashed' ? Effect.die(new Error(outcome.detail)) : unworkableWith(outcome);
}

export function viewAnswered(view: Schema.Json, schema: CompiledSchema | undefined): Ending {
  const checked = schema === undefined ? Result.succeed(view) : schema.validate(view);
  if (Result.isFailure(checked)) {
    const issues = issuesDetail(checked.failure.slice(0, mostIssuesInADetail), 'output');
    return unworkable(`The view does not match the output schema: ${issues}`);
  }
  return Effect.succeed({ output: view, work: 0, milliseconds: 0, bytes: jsonBytesOf(view) });
}
