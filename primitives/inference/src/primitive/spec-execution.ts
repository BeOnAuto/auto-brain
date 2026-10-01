import type { Finished } from '@beonauto/specs';
import { Clock, Effect, type Schema } from 'effect';

import type { LanguageModel } from '../model/language-model.ts';
import type { InferenceSpec } from '../spec/inference-spec.ts';
import { finishedWith } from './execution-record.ts';
import { rejections, type SpecRejection } from './model-rejection.ts';
import { preparedInput } from './prepared-input.ts';
import { renderedPrompt } from './rendered-prompt.ts';
import { requestFor } from './spec-request.ts';

export interface ExecutionServices {
  readonly languageModel: LanguageModel['Service'];
  readonly clock?: Clock.Clock;
}

function outputOf({ text, json }: { readonly text: string; readonly json?: Schema.Json }): Schema.Json {
  return json === undefined ? text : json;
}

export function specExecution({
  languageModel,
  clock,
}: ExecutionServices): (spec: InferenceSpec, input: Schema.Json) => Effect.Effect<Finished, SpecRejection> {
  const currentTime = clock === undefined ? Clock.currentTimeMillis : clock.currentTimeMillis;
  return Effect.fnUntraced(function* (spec: InferenceSpec, input: Schema.Json) {
    const fields = yield* preparedInput(input, spec.input);
    const now = new Date(yield* currentTime).toISOString();
    const prompt = yield* renderedPrompt(spec.template, { input: fields, today: now.slice(0, 10), now });
    const result = yield* languageModel
      .generate(requestFor(spec, prompt))
      .pipe(Effect.catchTags(rejections(spec.settings.max_output_tokens)));
    return yield* finishedWith(outputOf(result), {
      prompt,
      settings: spec.settings,
      format: spec.output.type,
      result,
    });
  });
}
