import { generateText, wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { Result } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelRequest, ToolCallSignals } from '../model/model-request.ts';
import { toolLoop } from '../tools/tool-loop.ts';
import { projected, readOutput, settledAnswer, type Answered } from './answer-settling.ts';
import { callSettingsOf, promptOf, providerOptionsOf, retriesOf } from './call-options.ts';
import { jsonOutput } from './json-output.ts';
import type { ModelTarget } from './model-resolution.ts';
import type { StepDeadline } from './stopped-call.ts';

type DoGenerate = Parameters<NonNullable<LanguageModelMiddleware['wrapGenerate']>>[0]['doGenerate'];

type Settled = Result.Result<Answered, ModelFailure>;

function callOf(request: ModelRequest, step: StepDeadline) {
  return {
    ...promptOf(request),
    ...callSettingsOf(request.settings),
    ...providerOptionsOf(request.provider_options),
    onLanguageModelCallStart: step.started,
    onLanguageModelCallEnd: step.ended,
    maxRetries: retriesOf(request),
  };
}

export async function callModel(
  target: ModelTarget,
  request: ModelRequest,
  signals: ToolCallSignals,
  step: StepDeadline,
): Promise<Settled> {
  const response: { id: string | null } = { id: null };
  const model = wrapLanguageModel({
    model: target.model(),
    middleware: {
      wrapGenerate: async ({ doGenerate }: { readonly doGenerate: DoGenerate }) => {
        const generated = await doGenerate();
        response.id = generated.response?.id ?? null;
        return generated;
      },
    },
  });
  const loop = toolLoop(request.tools, signals.cancelled);
  const { tools, prepareStep, stopWhen } = loop;
  const call = {
    model,
    ...callOf(request, step),
    tools: { ...tools },
    prepareStep,
    stopWhen,
    abortSignal: signals.signal,
  };
  if (request.output.type === 'text') {
    const result = await generateText(call);
    return (
      loop.unanswered(target.provider, result.finishReason) ??
      settledAnswer(target, projected(result, response.id), { kind: 'text' }, request.tools)
    );
  }
  const output = jsonOutput(request.output);
  if (Result.isFailure(output)) {
    return Result.fail(output.failure);
  }
  const result = await generateText({ ...call, output: output.success });
  return (
    loop.unanswered(target.provider, result.finishReason) ??
    settledAnswer(
      target,
      projected(result, response.id),
      readOutput(() => result.output),
      request.tools,
    )
  );
}
