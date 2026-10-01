import type { ModelRequest } from '../model/model-request.ts';
import type { InferenceSpec } from '../spec/inference-spec.ts';
import type { RenderedPrompt } from '../template/compiled-template.ts';

const firstAnswerMilliseconds = 60_000;

const millisecondsPerOutputToken = 25;

function timeoutFor(maxOutputTokens: number): number {
  return firstAnswerMilliseconds + millisecondsPerOutputToken * maxOutputTokens;
}

export function requestFor(spec: InferenceSpec, { instructions, message }: RenderedPrompt): ModelRequest {
  return {
    model: spec.model,
    ...(instructions === undefined ? {} : { instructions }),
    messages: [{ role: 'user', content: [{ type: 'text', text: message }] }],
    output: spec.output,
    settings: spec.settings,
    ...(spec.provider_options === undefined ? {} : { provider_options: spec.provider_options }),
    timeout_ms: timeoutFor(spec.settings.max_output_tokens),
  };
}
