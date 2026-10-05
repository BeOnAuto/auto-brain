import type { ToolAccess } from '@beonauto/mcp';
import type { ExecutionContext } from '@beonauto/specs';
import { Effect } from 'effect';

import type { LanguageModel } from '../model/language-model.ts';
import type { ModelResult } from '../model/model-result.ts';
import type { InferenceSpec } from '../spec/inference-spec.ts';
import type { RenderedPrompt } from '../template/compiled-template.ts';
import { withTools } from '../tools/tool-opening.ts';
import { rejections, type SpecRejection } from './model-rejection.ts';
import { requestFor } from './spec-request.ts';

export interface Answering {
  readonly languageModel: LanguageModel['Service'];
  readonly access: ToolAccess | undefined;
  readonly spec: InferenceSpec;
  readonly prompt: RenderedPrompt;
  readonly execution: ExecutionContext;
}

export function answerOf({
  languageModel,
  access,
  spec,
  prompt,
  execution,
}: Answering): Effect.Effect<ModelResult, SpecRejection> {
  return withTools(access, spec.tools, execution, (tools) =>
    languageModel
      .generate(requestFor(spec, prompt, execution, tools))
      .pipe(Effect.catchTags(rejections(spec.settings.max_output_tokens, tools))),
  );
}
