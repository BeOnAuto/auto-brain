import { randomBytes } from 'node:crypto';

import type { FinishReason, ModelMessage, Tool } from 'ai';
import { Result } from 'effect';

import { ToolsStopped } from '../failure/tools-stopped.ts';
import type { ModelTools } from '../model/model-request.ts';
import { finalStepMessages, type StepMessage } from './final-step.ts';
import { offeredTools } from './offered-tools.ts';

interface FinalStep {
  readonly activeTools: never[];
  readonly messages: ModelMessage[];
}

type NoChange = Readonly<Record<string, never>>;

export interface ToolLoop {
  readonly tools: Readonly<Record<string, Tool>>;
  readonly prepareStep: (step: { readonly messages: readonly StepMessage[] }) => FinalStep | NoChange;
  readonly stopWhen: () => boolean;
  readonly unanswered: (provider: string, finishReason: FinishReason) => Result.Result<never, ToolsStopped> | undefined;
}

function neverUnanswered(): undefined {}

function unanswered(provider: string, finishReason: FinishReason): Result.Result<never, ToolsStopped> | undefined {
  return finishReason === 'tool-calls'
    ? Result.fail(
        new ToolsStopped({
          detail: `${provider} kept calling tools in the step that withheld them, instead of answering`,
          provider,
          because: 'no_answer',
        }),
      )
    : undefined;
}

export function toolLoop(tools: ModelTools | undefined, cancelled: Readonly<AbortSignal>): ToolLoop {
  const state = { final: false };
  const stopWhen = (): boolean => state.final;
  if (tools === undefined) {
    return { tools: {}, prepareStep: () => ({}), stopWhen, unanswered: neverUnanswered };
  }
  return {
    tools: offeredTools(tools, cancelled),
    prepareStep: ({ messages }) => {
      if (state.final || !tools.callsEnded()) {
        return {};
      }
      state.final = true;
      return { activeTools: [], messages: finalStepMessages(messages, randomBytes(16).toString('hex')) };
    },
    stopWhen,
    unanswered,
  };
}
