import type { ToolAccess } from '@beonauto/mcp';
import type { RunContext, Finished } from '@beonauto/specs';
import { Clock, Effect, type Schema } from 'effect';

import type { LanguageModel } from '../model/language-model.ts';
import type { ReasoningFunctionDefinitionDocument } from '../spec/reasoning-function-definition.ts';
import { finishedWith } from './execution-record.ts';
import type { SpecRejection } from './model-rejection.ts';
import { preparedInput } from './prepared-input.ts';
import { renderedPrompt } from './rendered-prompt.ts';
import { answerOf } from './spec-answer.ts';

export interface ExecutionServices {
  readonly languageModel: LanguageModel['Service'];
  readonly clock?: Clock.Clock;
  readonly tools?: ToolAccess;
}

function outputOf({ text, json }: { readonly text: string; readonly json?: Schema.Json }): Schema.Json {
  return json === undefined ? text : json;
}

export function specExecution({
  languageModel,
  clock,
  tools: access,
}: ExecutionServices): (
  spec: ReasoningFunctionDefinitionDocument,
  input: Schema.Json,
  execution: RunContext,
) => Effect.Effect<Finished, SpecRejection> {
  const currentTime = clock === undefined ? Clock.currentTimeMillis : clock.currentTimeMillis;
  return Effect.fnUntraced(function* (
    spec: ReasoningFunctionDefinitionDocument,
    input: Schema.Json,
    execution: RunContext,
  ) {
    const fields = yield* preparedInput(input, spec.input);
    const now = new Date(yield* currentTime).toISOString();
    const prompt = yield* renderedPrompt(spec.template, { input: fields, today: now.slice(0, 10), now });
    const result = yield* answerOf({ languageModel, access, spec, prompt, execution });
    return yield* finishedWith(outputOf(result), {
      prompt,
      settings: spec.settings,
      format: spec.output.type,
      result,
    });
  });
}
