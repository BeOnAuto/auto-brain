import { Conflict, type Unavailable } from '@beonauto/operations';
import type { CompiledSchema } from '@beonauto/specs/document';
import { jsonBytesOf, type ProgramPool, type ProgramRequest } from '@beonauto/workflow-engine/dsl';
import type { ViewsPort } from '@beonauto/workflow-host';
import { Effect, Result, type Schema } from 'effect';

import { answerDialect, answerVariable } from '../document/recall-dialects.ts';
import type { RecallAnswer, RecallFunctionDefinitionDocument } from '../document/recall-document.ts';
import { answerEndingOf, type Answered } from './answer-endings.ts';
import { mostOutputBytes, recallLimits } from './recall-bounds.ts';

export interface RecallRunOptions {
  readonly pool: ProgramPool;
  readonly views: ViewsPort;
  readonly deadlineMs: number;
}

type Answering = Effect.Effect<Answered, Conflict | Unavailable>;

const answerWorker = new URL('./answer-worker.ts', import.meta.url);

const mostIssuesInADetail = 3;

function checkedBy({ output }: RecallFunctionDefinitionDocument): Pick<ProgramRequest, 'worker' | 'context'> {
  return output.schema === undefined ? {} : { worker: answerWorker, context: output.schema.document };
}

function viewAnswered(view: Schema.Json, schema: CompiledSchema | undefined): Answering {
  const checked = schema === undefined ? Result.succeed(view) : schema.validate(view);
  if (Result.isFailure(checked)) {
    const issues = checked.failure
      .slice(0, mostIssuesInADetail)
      .map(({ pointer, detail }) => `${pointer === '' ? 'the output' : pointer}: ${detail}`);
    return Effect.fail(
      new Conflict({ detail: `The view does not match the output schema: ${issues.join('; ')}`, kind: 'unworkable' }),
    );
  }
  return Effect.succeed({ output: view, work: 0, milliseconds: 0, bytes: jsonBytesOf(view) });
}

function answeredBy(
  { pool, deadlineMs }: RecallRunOptions,
  document: RecallFunctionDefinitionDocument,
  answer: RecallAnswer,
  facts: { readonly view: Schema.Json; readonly input: Schema.Json },
): Answering {
  return Effect.promise((signal) =>
    pool.run(
      {
        source: answer.source,
        input: facts.view,
        variables: { [answerVariable]: facts.input },
        dialect: answerDialect,
        limits: recallLimits,
        deadlineMs,
        mostOutputBytes,
        ...checkedBy(document),
      },
      signal,
    ),
  ).pipe(
    Effect.flatMap((outcome) =>
      answerEndingOf(outcome, { answer, workers: pool.workers, heapMegabytes: pool.heapMegabytes, deadlineMs }),
    ),
  );
}

export function answerOf(
  options: RecallRunOptions,
  document: RecallFunctionDefinitionDocument,
  view: Schema.Json,
  input: Schema.Json,
): Answering {
  const { answer } = document;
  return answer === undefined
    ? viewAnswered(view, document.output.schema)
    : answeredBy(options, document, answer, { view, input });
}
