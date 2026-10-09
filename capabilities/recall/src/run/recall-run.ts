import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@beonauto/definitions';
import { Conflict, Unavailable, type InvalidInput } from '@beonauto/operations';
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
  run: RunContext,
) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;

function rebuilding(views: ViewsPort, { org, brain, definition }: RunContext, kept: KeptView | undefined) {
  return views.newestRecordAt({ org, brain }).pipe(
    Effect.flatMap((newestAt) =>
      Effect.fail(
        new Unavailable({
          detail: rebuildingDetail(definition.name, definition.version, kept, newestAt),
          kind: 'rebuilding',
        }),
      ),
    ),
  );
}

function recordOf(kept: KeptView, answered: Answered, input: Schema.Json): Schema.JsonObject {
  return {
    language: 'typescript',
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
): Effect.Effect<CapabilityAnswer, Conflict | Unavailable> {
  return answerOf(options, document, kept.view, input).pipe(
    Effect.map((answered) => ({ output: answered.output, record: recordOf(kept, answered, input) })),
  );
}

function ranOn(
  options: RecallRunOptions,
  document: RecallFunctionDefinitionDocument,
  run: RunContext,
  input: Schema.Json,
) {
  return (kept: KeptView | undefined): Effect.Effect<CapabilityAnswer, Conflict | Unavailable> => {
    if (kept?.version !== run.definition.version || kept.phase === 'rebuilding' || kept.phase === 'waiting') {
      return rebuilding(options.views, run, kept);
    }
    if (kept.stall !== undefined) {
      return Effect.fail(new Conflict({ detail: stalledDetail(run.definition.name, kept.stall), kind: 'stalled' }));
    }
    return answeredFrom(options, document, kept, input);
  };
}

export function recallRun(options: RecallRunOptions): RecallRun {
  return (document, input, run) =>
    preparedInput(input, document.input).pipe(
      Effect.flatMap((admitted): Effect.Effect<CapabilityAnswer, CapabilityRejection | InvalidInput> =>
        options.views
          .viewOf({ org: run.org, brain: run.brain }, run.definition.name)
          .pipe(Effect.flatMap(ranOn(options, document, run, admitted))),
      ),
    );
}
