import type { Conflict, Unavailable } from '@beonauto/operations';
import { checkedWorker } from '@beonauto/specs/json-schema';
import type { ProgramPool, ProgramRequest } from '@beonauto/workflow-engine/dsl';
import type { ViewsPort } from '@beonauto/workflow-host';
import { Effect, type Schema } from 'effect';

import { answerDialect, answerVariable } from '../document/recall-dialects.ts';
import type { RecallAnswer, RecallFunctionDefinitionDocument } from '../document/recall-document.ts';
import { answerEndingOf, viewAnswered, type Answered } from './answer-endings.ts';
import { mostOutputBytes, recallLimits } from './recall-bounds.ts';

export interface RecallRunOptions {
  readonly pool: ProgramPool;
  readonly views: ViewsPort;
  readonly deadlineMs: number;
}

type Answering = Effect.Effect<Answered, Conflict | Unavailable>;

function checkedBy({ output }: RecallFunctionDefinitionDocument): Pick<ProgramRequest, 'worker' | 'context'> {
  return output.schema === undefined ? {} : { worker: checkedWorker, context: output.schema.document };
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
