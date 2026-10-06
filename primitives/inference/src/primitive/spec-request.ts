import type { RunContext } from '@beonauto/specs';

import type { ModelRequest } from '../model/model-request.ts';
import type { ReasoningFunctionDefinitionDocument } from '../spec/reasoning-function-definition.ts';
import { mostOutputTokens } from '../spec/spec-settings.ts';
import type { RenderedPrompt } from '../template/compiled-template.ts';

const firstAnswerMilliseconds = 60_000;

const millisecondsPerOutputToken = 25;

function timeoutFor(maxOutputTokens: number): number {
  return firstAnswerMilliseconds + millisecondsPerOutputToken * maxOutputTokens;
}

export const longestRequestMs = timeoutFor(mostOutputTokens);

export function requestFor(
  spec: ReasoningFunctionDefinitionDocument,
  { instructions, message }: RenderedPrompt,
  execution: RunContext,
): ModelRequest {
  return {
    model: spec.model,
    ...(instructions === undefined ? {} : { instructions }),
    messages: [{ role: 'user', content: [{ type: 'text', text: message }] }],
    output: spec.output,
    settings: spec.settings,
    ...(spec.provider_options === undefined ? {} : { provider_options: spec.provider_options }),
    timeout_ms: timeoutFor(spec.settings.max_output_tokens),
    execution_id: execution.id,
  };
}
