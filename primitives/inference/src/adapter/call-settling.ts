import { Result } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { Answered } from './answer-settling.ts';
import { scrubberFor, type CallPolicy } from './call-policy.ts';
import { classified, operatorHintOf, providerTextOf, type ProviderText } from './failure-classification.ts';
import { callModel } from './model-call.ts';
import type { ModelTarget } from './model-resolution.ts';
import { deadlineOf, stoppedFailure } from './stopped-call.ts';
import type { UnclassifiedModelError } from './unclassified-model-error.ts';

type Settled = Result.Result<Answered, ModelFailure | UnclassifiedModelError>;

export interface CallReports {
  readonly providerText: ProviderText | null;
  readonly operatorHint: string | null;
}

export interface SettledCall extends CallReports {
  readonly settled: Settled;
}

export async function settledCall(
  target: ModelTarget,
  request: ModelRequest,
  interruption: Readonly<AbortSignal>,
  policy: CallPolicy,
): Promise<SettledCall> {
  const deadline = deadlineOf(request);
  const signals = [interruption, deadline?.signal, request.signal].filter((signal) => signal !== undefined);
  try {
    return {
      settled: await callModel(target, request, AbortSignal.any(signals)),
      providerText: null,
      operatorHint: null,
    };
  } catch (error) {
    const { provider } = target;
    const scrub = scrubberFor(policy, request);
    const context = {
      provider,
      configured: policy.configured,
      now: Date.now(),
      showsProviderMessages: policy.showsProviderMessages(provider),
      scrub,
    };
    return {
      settled: Result.fail(stoppedFailure(provider, request, deadline) ?? classified(error, context)),
      providerText: providerTextOf(error, scrub),
      operatorHint: operatorHintOf(error, provider, scrub),
    };
  }
}
