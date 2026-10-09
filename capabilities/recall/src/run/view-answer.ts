import { checkedWorker } from '@beonauto/definitions/json-schema';
import type { Conflict, Unavailable } from '@beonauto/operations';
import type { ProgramPool, ProgramRequest } from '@beonauto/workflow-engine/dsl';
import type { ViewsPort } from '@beonauto/workflow-host';
import { Clock, Effect, type Schema } from 'effect';

import type { RecallFunctionDefinitionDocument } from '../document/recall-document.ts';
import { answerEndingOf, viewAnswered, type Answered } from './answer-endings.ts';
import { mostOutputBytes, recallBounds } from './recall-bounds.ts';

export interface RecallRunOptions {
  readonly pool: ProgramPool;
  readonly views: ViewsPort;
  readonly deadlineMs: number;
}

interface Asked {
  readonly view: Schema.Json;
  readonly input: Schema.Json;
  readonly moment: number;
}

type Answering = Effect.Effect<Answered, Conflict | Unavailable>;

function requestOf(
  document: RecallFunctionDefinitionDocument,
  { view, input, moment }: Asked,
  deadlineMs: number,
): ProgramRequest {
  return {
    source: document.details.fold,
    entry: 'answer',
    arguments: [view, input],
    moment,
    budget: recallBounds.budget,
    memoryBytes: recallBounds.answerMemoryBytes,
    stackBytes: recallBounds.stackBytes,
    deadlineMs,
    mostOutputBytes,
    worker: checkedWorker,
    context: document.output.schema?.document ?? null,
  };
}

function answeredBy(
  { pool, deadlineMs }: RecallRunOptions,
  document: RecallFunctionDefinitionDocument,
  asked: Asked,
): Answering {
  return Effect.promise((signal) => pool.run(requestOf(document, asked, deadlineMs), signal)).pipe(
    Effect.flatMap((outcome) =>
      answerEndingOf(outcome, {
        foldLine: document.details.foldLine,
        workers: pool.workers,
        heapMegabytes: pool.heapMegabytes,
        deadlineMs,
      }),
    ),
  );
}

export function answerOf(
  options: RecallRunOptions,
  document: RecallFunctionDefinitionDocument,
  view: Schema.Json,
  input: Schema.Json,
): Answering {
  return document.answers
    ? Effect.flatMap(Clock.currentTimeMillis, (moment) => answeredBy(options, document, { view, input, moment }))
    : viewAnswered(view, document.output.schema);
}
