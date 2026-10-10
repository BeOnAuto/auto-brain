import { randomBytes } from 'node:crypto';

import type { FinishReason, ModelMessage, Tool } from 'ai';
import { Result } from 'effect';

import { tokenUsage, type SdkUsage } from '../adapter/answer-mapping.ts';
import { ToolsStopped } from '../failure/tools-stopped.ts';
import type { ModelTools } from '../model/model-request.ts';
import { inputTokensOf, type SpentStep } from './answer-room.ts';
import { finalStepMessages, type StepMessage } from './final-step.ts';
import { offeredTools } from './offered-tools.ts';

interface FinalStep {
  readonly activeTools: never[];
  readonly messages: ModelMessage[];
}

type NoChange = Readonly<Record<string, never>>;

export interface ToolLoop {
  readonly tools: Readonly<Record<string, Tool>>;
  readonly prepareStep: (step: {
    readonly messages: readonly StepMessage[];
    readonly steps: readonly SpentStep[];
  }) => FinalStep | NoChange;
  readonly stopWhen: () => boolean;
  readonly unanswered: (
    provider: string,
    finishReason: FinishReason,
    usage: SdkUsage,
  ) => Result.Result<never, ToolsStopped> | undefined;
}

function neverUnanswered(): undefined {}

function unanswered(
  provider: string,
  finishReason: FinishReason,
  usage: SdkUsage,
): Result.Result<never, ToolsStopped> | undefined {
  return finishReason === 'tool-calls'
    ? Result.fail(
        new ToolsStopped({
          detail: `${provider} kept calling tools in the step that withheld them, instead of answering`,
          provider,
          because: 'no_answer',
          usage: tokenUsage(usage),
        }),
      )
    : undefined;
}

function spentEverything(tools: ModelTools, steps: readonly SpentStep[]): boolean {
  return tools.callsEnded() || inputTokensOf(steps) >= tools.mostInputTokens;
}

export function toolLoop(
  tools: ModelTools | undefined,
  cancelled: Readonly<AbortSignal>,
  maxOutputTokens: number,
): ToolLoop {
  const state = { final: false };
  const stopWhen = (): boolean => state.final;
  if (tools === undefined) {
    return { tools: {}, prepareStep: () => ({}), stopWhen, unanswered: neverUnanswered };
  }
  return {
    tools: offeredTools(tools, cancelled, maxOutputTokens),
    prepareStep: ({ messages, steps }) => {
      if (state.final || !spentEverything(tools, steps)) {
        return {};
      }
      state.final = true;
      return { activeTools: [], messages: finalStepMessages(messages, randomBytes(16).toString('hex')) };
    },
    stopWhen,
    unanswered,
  };
}
