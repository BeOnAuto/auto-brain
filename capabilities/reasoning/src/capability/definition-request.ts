import type { RunContext } from '@beonauto/definitions';
import type { RunTools } from '@beonauto/mcp';
import { runBoundMs } from '@beonauto/mcp/policy';
import { Effect } from 'effect';

import { mostOutputTokens } from '../definition/definition-settings.ts';
import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import type { ModelRequest, ModelTools } from '../model/model-request.ts';
import type { RenderedPrompt } from '../template/compiled-template.ts';

const firstAnswerMilliseconds = 60_000;

const millisecondsPerOutputToken = 25;

function timeoutFor(maxOutputTokens: number): number {
  return firstAnswerMilliseconds + millisecondsPerOutputToken * maxOutputTokens;
}

export const longestRequestMs = timeoutFor(mostOutputTokens);

export function longestRunMsOf({ settings, tools }: ReasoningFunctionDefinitionDocument): number {
  const timeoutMs = timeoutFor(settings.max_output_tokens);
  return tools.length === 0 ? timeoutMs : runBoundMs(timeoutMs);
}

export const defaultMostInputTokens = 2_000_000;

export interface ModelReading {
  readonly mostInputTokens: number;
  readonly contextWindowOf: (model: string) => Effect.Effect<number | undefined>;
}

export const unknownWindows: ModelReading = {
  mostInputTokens: defaultMostInputTokens,
  contextWindowOf: () => Effect.undefined,
};

export function windowFor(
  { contextWindowOf }: ModelReading,
  model: string,
  tools: RunTools | undefined,
): Effect.Effect<number | undefined> {
  return tools === undefined ? Effect.undefined : contextWindowOf(model);
}

interface ToolReading {
  readonly mostInputTokens: number;
  readonly contextWindow: number | undefined;
}

export interface RequestTools {
  readonly tools: RunTools | undefined;
  readonly reading: ToolReading;
}

function modelToolsOf(
  { offered, callsEnded, calledAny, ended }: RunTools,
  { mostInputTokens, contextWindow }: ToolReading,
  timeoutMs: number,
): ModelTools {
  return {
    offered,
    callsEnded,
    calledAny,
    ended,
    runBoundMs: runBoundMs(timeoutMs),
    mostInputTokens,
    ...(contextWindow === undefined ? {} : { contextWindow }),
  };
}

export function requestFor(
  definition: ReasoningFunctionDefinitionDocument,
  { instructions, message }: RenderedPrompt,
  run: RunContext,
  using?: RequestTools,
): ModelRequest {
  const timeoutMs = timeoutFor(definition.settings.max_output_tokens);
  return {
    model: definition.model,
    ...(instructions === undefined ? {} : { instructions }),
    messages: [{ role: 'user', content: [{ type: 'text', text: message }] }],
    output: definition.output,
    settings: definition.settings,
    ...(definition.provider_options === undefined ? {} : { provider_options: definition.provider_options }),
    timeout_ms: timeoutMs,
    run_id: run.id,
    ...(using?.tools === undefined ? {} : { tools: modelToolsOf(using.tools, using.reading, timeoutMs) }),
  };
}
