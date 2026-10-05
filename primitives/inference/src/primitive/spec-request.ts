import { runBoundMs, type RunTools } from '@beonauto/mcp';
import type { ExecutionContext } from '@beonauto/specs';

import type { ModelRequest, ModelTools } from '../model/model-request.ts';
import type { InferenceSpec } from '../spec/inference-spec.ts';
import { mostOutputTokens } from '../spec/spec-settings.ts';
import type { RenderedPrompt } from '../template/compiled-template.ts';

const firstAnswerMilliseconds = 60_000;

const millisecondsPerOutputToken = 25;

function timeoutFor(maxOutputTokens: number): number {
  return firstAnswerMilliseconds + millisecondsPerOutputToken * maxOutputTokens;
}

export const longestRequestMs = timeoutFor(mostOutputTokens);

function modelToolsOf({ offered, callsEnded, ended }: RunTools, timeoutMs: number): ModelTools {
  return { offered, callsEnded, ended, runBoundMs: runBoundMs(timeoutMs) };
}

export function requestFor(
  spec: InferenceSpec,
  { instructions, message }: RenderedPrompt,
  execution: ExecutionContext,
  tools: RunTools | undefined,
): ModelRequest {
  const timeoutMs = timeoutFor(spec.settings.max_output_tokens);
  return {
    model: spec.model,
    ...(instructions === undefined ? {} : { instructions }),
    messages: [{ role: 'user', content: [{ type: 'text', text: message }] }],
    output: spec.output,
    settings: spec.settings,
    ...(spec.provider_options === undefined ? {} : { provider_options: spec.provider_options }),
    timeout_ms: timeoutMs,
    execution_id: execution.id,
    ...(tools === undefined ? {} : { tools: modelToolsOf(tools, timeoutMs) }),
  };
}
