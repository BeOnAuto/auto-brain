import type { FinishReason as SdkFinishReason } from 'ai';
import { Array as Arr, Result, type Schema } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelResult } from '../model/model-result.ts';
import { finishReasonOf, tokenUsage, warningOf, type SdkUsage, type SdkWarning } from './answer-mapping.ts';
import type { ModelTarget } from './model-resolution.ts';
import { outputFailure } from './output-failure.ts';

export type Answered = Omit<ModelResult, 'duration_ms'>;

export interface SdkResult {
  readonly text: string;
  readonly finishReason: SdkFinishReason;
  readonly rawFinishReason: string | undefined;
  readonly usage: SdkUsage;
  readonly warnings: readonly SdkWarning[] | undefined;
  readonly response: { readonly modelId: string };
}

export type ReadOutput =
  | { readonly kind: 'text' }
  | { readonly kind: 'json'; readonly value: Schema.Json }
  | { readonly kind: 'missing' };

export interface Generated {
  readonly text: string;
  readonly finishReason: SdkFinishReason;
  readonly rawFinishReason: string | undefined;
  readonly usage: SdkUsage;
  readonly warnings: readonly SdkWarning[];
  readonly answeredModel: string;
  readonly responseId: string | null;
}

export function projected(result: SdkResult, responseId: string | null): Generated {
  return {
    text: result.text,
    finishReason: result.finishReason,
    rawFinishReason: result.rawFinishReason,
    usage: result.usage,
    warnings: Arr.flatten(Arr.fromNullishOr(result.warnings)),
    answeredModel: result.response.modelId,
    responseId,
  };
}

function answered(target: ModelTarget, generated: Generated): Answered {
  return {
    text: generated.text,
    finish_reason: finishReasonOf(generated.finishReason),
    raw_finish_reason: generated.rawFinishReason ?? null,
    usage: tokenUsage(generated.usage),
    model: { requested: target.requested, resolved: target.resolved, answered: generated.answeredModel },
    response_id: generated.responseId,
    warnings: generated.warnings.map((warning) => warningOf(warning)),
  };
}

export function settledAnswer(
  target: ModelTarget,
  generated: Generated,
  output: ReadOutput,
): Result.Result<Answered, ModelFailure> {
  if (generated.finishReason === 'content-filter' || output.kind === 'missing') {
    return Result.fail(outputFailure({ provider: target.provider, ...generated, cause: undefined }));
  }
  const answer = answered(target, generated);
  return Result.succeed(output.kind === 'json' ? { ...answer, json: output.value } : answer);
}

export function readOutput(read: () => Schema.Json): ReadOutput {
  try {
    return { kind: 'json', value: read() };
  } catch {
    return { kind: 'missing' };
  }
}
