import { Conflict, Unavailable } from '@beonauto/operations';
import type { Finished } from '@beonauto/specs';
import {
  lineOf,
  type PoolOutcome,
  type ProgramSpan,
  type Stopped,
  workerStackMegabytes,
} from '@beonauto/workflow-engine/dsl';
import { Effect, type Schema } from 'effect';

import type { ComputationFunctionDefinitionDocument } from '../document/computation-document.ts';
import { computationBounds, mostOutputBytes } from './run-bounds.ts';

export interface RunFacts {
  readonly document: ComputationFunctionDefinitionDocument;
  readonly inputBytes: number;
  readonly workers: number;
  readonly deadlineMs: number;
}

type Ending = Effect.Effect<Finished, Conflict | Unavailable>;

type Answered = Extract<PoolOutcome, { readonly ran: 'answered' }>;

type Exhausted = Extract<PoolOutcome, { readonly ran: 'exhausted' }>;

function unworkable(detail: string): Ending {
  return Effect.fail(new Conflict({ detail, kind: 'unworkable' }));
}

function lineAt({ program, programLine }: ComputationFunctionDefinitionDocument, span: ProgramSpan): number {
  return programLine + lineOf(program, span.start) - 1;
}

function recordOf(answered: Answered, { inputBytes }: RunFacts): Schema.JsonObject {
  return {
    language: 'jq',
    work: answered.work,
    duration_ms: Math.round(answered.milliseconds),
    input_bytes: inputBytes,
    output_bytes: answered.bytes,
  };
}

function finishedWith(answered: Answered, facts: RunFacts): Ending {
  return Effect.succeed({ output: answered.output, record: recordOf(answered, facts) });
}

const stoppedBecause: Readonly<Record<Stopped, (facts: RunFacts) => string>> = {
  deadline: ({ deadlineMs }) =>
    `The run took longer than the ${deadlineMs} ms a computation function may run, and was stopped`,
  memory: () =>
    `The run took more than the ${computationBounds.heapMegabytes} MiB of memory a computation function may use, and was stopped`,
  busy: ({ workers, deadlineMs }) =>
    `No worker was free to run it within ${deadlineMs} ms; this server runs ${workers} computation functions at once`,
  cancelled: () => 'The run was stopped before it ended',
  closing: () => 'The server is stopping',
};

function exhaustedWith({ limit, issue, work }: Exhausted, facts: RunFacts): Ending {
  const line = lineAt(facts.document, issue.span);
  if (limit === 'deadline') {
    return Effect.fail(new Unavailable({ detail: stoppedBecause.deadline(facts) }));
  }
  if (limit === 'depth') {
    return unworkable(
      `The program recursed deeper than the ${computationBounds.mostEvaluationDepth} levels of evaluation a run may nest, on line ${line}`,
    );
  }
  if (limit === 'stack') {
    return unworkable(`The program went deeper than the ${workerStackMegabytes} MiB stack of a run allows`);
  }
  return limit === 'work'
    ? unworkable(
        `The program did more than the ${computationBounds.mostWork} units of work a run may do, on line ${line}, having done ${work}`,
      )
    : unworkable(
        `The program built a value that nests deeper than the ${computationBounds.mostValueDepth} levels a value may, on line ${line}`,
      );
}

function raisedWith(detail: string, span: ProgramSpan, { document }: RunFacts): Ending {
  return unworkable(`The program raised an error on line ${lineAt(document, span)}: ${detail}`);
}

type Unworkable = Extract<
  PoolOutcome,
  { readonly ran: 'oversized' | 'mismatched' | 'unanswered' | 'unfit' | 'refused' }
>;

function unworkableWith(outcome: Unworkable): Ending {
  if (outcome.ran === 'refused') {
    return Effect.die(new Error('The worker refused a program the definition was accepted with'));
  }
  if (outcome.ran === 'mismatched') {
    return unworkable(`The program's output does not match the output schema: ${outcome.issues.join('; ')}`);
  }
  if (outcome.ran === 'oversized') {
    return unworkable(`The program's output takes more than the ${mostOutputBytes} bytes as JSON a run can record`);
  }
  if (outcome.ran === 'unfit') {
    return unworkable('The program gave a number JSON cannot carry, such as nan or infinite');
  }
  return unworkable(
    `The program gave ${outcome.outputs === 0 ? 'no output' : 'more than one output'}; a computation function gives exactly one`,
  );
}

export function endingOf(outcome: PoolOutcome, facts: RunFacts): Ending {
  if (outcome.ran === 'answered') {
    return finishedWith(outcome, facts);
  }
  if (outcome.ran === 'raised') {
    return raisedWith(outcome.issue.detail, outcome.issue.span, facts);
  }
  if (outcome.ran === 'exhausted') {
    return exhaustedWith(outcome, facts);
  }
  if (outcome.ran === 'stopped') {
    return Effect.fail(new Unavailable({ detail: stoppedBecause[outcome.because](facts) }));
  }
  return outcome.ran === 'crashed' ? Effect.die(new Error(outcome.detail)) : unworkableWith(outcome);
}
