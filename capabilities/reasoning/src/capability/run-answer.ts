import type { RunContext } from '@beonauto/definitions';
import type { ToolAccess } from '@beonauto/mcp';
import { Clock, Effect } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import type { LanguageModel } from '../model/language-model.ts';
import type { ModelResult } from '../model/model-result.ts';
import type { RenderedPrompt } from '../template/compiled-template.ts';
import { withTools } from '../tools/tool-opening.ts';
import { requestFor } from './definition-request.ts';
import { rejections, spendingSince, type DefinitionRejection } from './model-rejection.ts';

export interface Answering {
  readonly languageModel: LanguageModel['Service'];
  readonly access: ToolAccess;
  readonly definition: ReasoningFunctionDefinitionDocument;
  readonly prompt: RenderedPrompt;
  readonly run: RunContext;
}

export function answerOf({
  languageModel,
  access,
  definition,
  prompt,
  run,
}: Answering): Effect.Effect<ModelResult, DefinitionRejection> {
  const { max_output_tokens: maxOutputTokens } = definition.settings;
  const admitted = Effect.flatMap(Clock.currentTimeMillis, (started) =>
    languageModel
      .admit(requestFor(definition, prompt, run))
      .pipe(Effect.catchTags(rejections(maxOutputTokens, spendingSince(started)))),
  );
  return Effect.andThen(
    admitted,
    withTools(access, definition.tools, run, (tools) =>
      Effect.flatMap(Clock.currentTimeMillis, (started) =>
        languageModel
          .generate(requestFor(definition, prompt, run, tools))
          .pipe(Effect.catchTags(rejections(maxOutputTokens, spendingSince(started), tools))),
      ),
    ),
  );
}
