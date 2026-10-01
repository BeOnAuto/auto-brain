import { Result } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { Answered } from './answer-settling.ts';
import { classified } from './failure-classification.ts';
import { callModel } from './model-call.ts';
import type { ModelTarget } from './model-resolution.ts';
import { deadlineOf, stoppedFailure } from './stopped-call.ts';
import type { UnclassifiedModelError } from './unclassified-model-error.ts';

export type Settled = Result.Result<Answered, ModelFailure | UnclassifiedModelError>;

export async function settledCall(
  target: ModelTarget,
  request: ModelRequest,
  interruption: Readonly<AbortSignal>,
  configured: readonly string[],
): Promise<Settled> {
  const deadline = deadlineOf(request);
  const signals = [interruption, deadline?.signal, request.signal].filter((signal) => signal !== undefined);
  try {
    return await callModel(target, request, AbortSignal.any(signals));
  } catch (error) {
    const context = { provider: target.provider, configured, now: Date.now() };
    return Result.fail(stoppedFailure(target.provider, request, deadline) ?? classified(error, context));
  }
}
