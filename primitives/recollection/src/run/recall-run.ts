import { Conflict, Unavailable, type InvalidInput } from '@beonauto/operations';
import type { Executed, PrimitiveRejection, RunContext } from '@beonauto/specs';
import { jsonBytesOf } from '@beonauto/workflow-engine/dsl';
import type { KeptView, ViewsPort } from '@beonauto/workflow-host';
import { Effect, type Schema } from 'effect';

import type { RecallFunctionDefinitionDocument } from '../document/recall-document.ts';
import type { Answered } from './answer-endings.ts';
import { preparedInput } from './run-input.ts';
import { answerOf, type RecallRunOptions } from './view-answer.ts';
import { rebuildingDetail, stalledDetail } from './view-words.ts';

export type RecallRun = (
  document: RecallFunctionDefinitionDocument,
  input: Schema.Json,
  execution: RunContext,
) => Effect.Effect<Executed, PrimitiveRejection>;

function rebuilding(views: ViewsPort, { org, brain, spec }: RunContext, kept: KeptView | undefined) {
  return views
    .newestRecordAt({ org, brain })
    .pipe(
      Effect.flatMap((newestAt) =>
        Effect.fail(
          new Unavailable({ detail: rebuildingDetail(spec.name, spec.version, kept, newestAt), kind: 'rebuilding' }),
        ),
      ),
    );
}

function recordOf(kept: KeptView, answered: Answered, input: Schema.Json): Schema.JsonObject {
  return {
    language: 'jq',
    work: answered.work,
    duration_ms: Math.round(answered.milliseconds),
    input_bytes: jsonBytesOf(input),
    output_bytes: answered.bytes,
    view: {
      version: kept.version,
      checkpoint: kept.checkpoint,
      checkpoint_at: kept.checkpointAt,
      folded: kept.folded,
      last_event: kept.lastEvent === null ? null : { id: kept.lastEvent.id, time: kept.lastEvent.time },
    },
  };
}

function answeredFrom(
  options: RecallRunOptions,
  document: RecallFunctionDefinitionDocument,
  kept: KeptView,
  input: Schema.Json,
): Effect.Effect<Executed, Conflict | Unavailable> {
  return answerOf(options, document, kept.view, input).pipe(
    Effect.map((answered) => ({ output: answered.output, record: recordOf(kept, answered, input) })),
  );
}

function ranOn(
  options: RecallRunOptions,
  document: RecallFunctionDefinitionDocument,
  execution: RunContext,
  input: Schema.Json,
) {
  return (kept: KeptView | undefined): Effect.Effect<Executed, Conflict | Unavailable> => {
    if (kept?.version !== execution.spec.version || kept.phase === 'rebuilding' || kept.phase === 'waiting') {
      return rebuilding(options.views, execution, kept);
    }
    if (kept.stall !== undefined) {
      return Effect.fail(new Conflict({ detail: stalledDetail(execution.spec.name, kept.stall), kind: 'stalled' }));
    }
    return answeredFrom(options, document, kept, input);
  };
}

export function recallRun(options: RecallRunOptions): RecallRun {
  return (document, input, execution) =>
    preparedInput(input, document.input).pipe(
      Effect.flatMap((admitted): Effect.Effect<Executed, PrimitiveRejection | InvalidInput> =>
        options.views
          .viewOf({ org: execution.org, brain: execution.brain }, execution.spec.name)
          .pipe(Effect.flatMap(ranOn(options, document, execution, admitted))),
      ),
    );
}
