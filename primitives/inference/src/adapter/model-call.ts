import { generateText, wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { Result } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelRequest } from '../model/model-request.ts';
import { projected, readOutput, settledAnswer, type Answered } from './answer-settling.ts';
import { callSettingsOf, promptOf, providerOptionsOf, retriesOf } from './call-options.ts';
import { jsonOutput } from './json-output.ts';
import type { ModelTarget } from './model-resolution.ts';

type DoGenerate = Parameters<NonNullable<LanguageModelMiddleware['wrapGenerate']>>[0]['doGenerate'];

export async function callModel(
  target: ModelTarget,
  request: ModelRequest,
  signal: Readonly<AbortSignal>,
): Promise<Result.Result<Answered, ModelFailure>> {
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
  const call = {
    model,
    ...promptOf(request),
    ...callSettingsOf(request.settings),
    ...providerOptionsOf(request.provider_options),
    maxRetries: retriesOf(request),
    abortSignal: signal,
  };
  if (request.output.type === 'text') {
    const result = await generateText(call);
    return settledAnswer(target, projected(result, response.id), { kind: 'text' });
  }
  const output = jsonOutput(request.output);
  if (Result.isFailure(output)) {
    return Result.fail(output.failure);
  }
  const result = await generateText({ ...call, output: output.success });
  return settledAnswer(
    target,
    projected(result, response.id),
    readOutput(() => result.output),
  );
}
