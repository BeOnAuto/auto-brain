import type { RunContext, Finished } from '@beonauto/definitions';
import type { ToolAccess } from '@beonauto/mcp';
import { Clock, Effect, type Schema } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import type { LanguageModel } from '../model/language-model.ts';
import type { DefinitionRejection } from './model-rejection.ts';
import { preparedInput } from './prepared-input.ts';
import { renderedPrompt } from './rendered-prompt.ts';
import { answerOf } from './run-answer.ts';
import { finishedWith } from './spending-record.ts';

export interface RunServices {
  readonly languageModel: LanguageModel['Service'];
  readonly clock?: Clock.Clock;
  readonly tools: ToolAccess;
}

function outputOf({ text, json }: { readonly text: string; readonly json?: Schema.Json }): Schema.Json {
  return json === undefined ? text : json;
}

export function definitionRun({
  languageModel,
  clock,
  tools: access,
}: RunServices): (
  definition: ReasoningFunctionDefinitionDocument,
  input: Schema.Json,
  run: RunContext,
) => Effect.Effect<Finished, DefinitionRejection> {
  const currentTime = clock === undefined ? Clock.currentTimeMillis : clock.currentTimeMillis;
  return Effect.fnUntraced(function* (
    definition: ReasoningFunctionDefinitionDocument,
    input: Schema.Json,
    run: RunContext,
  ) {
    const fields = yield* preparedInput(input, definition.input);
    const now = new Date(yield* currentTime).toISOString();
    const prompt = yield* renderedPrompt(definition.template, { input: fields, today: now.slice(0, 10), now });
    const result = yield* answerOf({ languageModel, access, definition, prompt, run });
    return yield* finishedWith(outputOf(result), {
      prompt,
      settings: definition.settings,
      format: definition.output.type,
      result,
    });
  });
}
