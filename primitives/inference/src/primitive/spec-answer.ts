import type { ToolAccess } from '@beonauto/mcp';
import type { RunContext } from '@beonauto/specs';
import { Clock, Effect } from 'effect';

import type { LanguageModel } from '../model/language-model.ts';
import type { ModelResult } from '../model/model-result.ts';
import type { ReasoningFunctionDefinitionDocument } from '../spec/reasoning-function-definition.ts';
import type { RenderedPrompt } from '../template/compiled-template.ts';
import { withTools } from '../tools/tool-opening.ts';
import { rejections, spendingSince, type SpecRejection } from './model-rejection.ts';
import { requestFor } from './spec-request.ts';

export interface Answering {
  readonly languageModel: LanguageModel['Service'];
  readonly access: ToolAccess | undefined;
  readonly spec: ReasoningFunctionDefinitionDocument;
  readonly prompt: RenderedPrompt;
  readonly execution: RunContext;
}

export function answerOf({
  languageModel,
  access,
  spec,
  prompt,
  execution,
}: Answering): Effect.Effect<ModelResult, SpecRejection> {
  const { max_output_tokens: maxOutputTokens } = spec.settings;
  const admitted = Effect.flatMap(Clock.currentTimeMillis, (started) =>
    languageModel
      .admit(requestFor(spec, prompt, execution))
      .pipe(Effect.catchTags(rejections(maxOutputTokens, spendingSince(started)))),
  );
  return Effect.andThen(
    admitted,
    withTools(access, spec.tools, execution, (tools) =>
      Effect.flatMap(Clock.currentTimeMillis, (started) =>
        languageModel
          .generate(requestFor(spec, prompt, execution, tools))
          .pipe(Effect.catchTags(rejections(maxOutputTokens, spendingSince(started), tools))),
      ),
    ),
  );
}
