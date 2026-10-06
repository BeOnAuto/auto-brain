import { Clock, Effect, Result } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { ModelResult } from '../model/model-result.ts';
import { checkedRequest } from '../model/request-checks.ts';
import type { CallPolicy } from './call-policy.ts';
import { settledCall, type CallReports } from './call-settling.ts';
import type { ModelResolution, ModelTarget } from './model-resolution.ts';
import { UnclassifiedModelError } from './unclassified-model-error.ts';

function reportsOf(
  policy: CallPolicy,
  { provider }: ModelTarget,
  { model, execution_id }: ModelRequest,
  { providerText, operatorHint }: CallReports,
): Effect.Effect<void> {
  const call = { provider, model, execution_id: execution_id ?? null };
  return Effect.all(
    [
      providerText === null ? Effect.void : policy.report({ ...call, ...providerText }),
      operatorHint === null ? Effect.void : policy.reportHint({ ...call, hint: operatorHint }),
    ],
    { discard: true },
  );
}

export interface Generation {
  readonly admit: (request: ModelRequest) => Effect.Effect<void, ModelFailure>;
  readonly generate: (request: ModelRequest) => Effect.Effect<ModelResult, ModelFailure>;
}

function admission(resolve: ModelResolution, policy: CallPolicy) {
  return Effect.fnUntraced(function* (request: ModelRequest) {
    yield* checkedRequest(request);
    const target = yield* Effect.fromResult(resolve(request.model));
    yield* Effect.fromResult(policy.admitsOptions(target.provider, request.provider_options));
    return target;
  });
}

export function generation(resolve: ModelResolution, policy: CallPolicy): Generation {
  const admitted = admission(resolve, policy);
  const generate = Effect.fnUntraced(function* (request: ModelRequest) {
    const target = yield* admitted(request);
    const started = yield* Clock.currentTimeMillis;
    const call = yield* Effect.promise((interruption: Readonly<AbortSignal>) =>
      settledCall(target, request, interruption, policy),
    );
    const finished = yield* Clock.currentTimeMillis;
    yield* reportsOf(policy, target, request, call);
    const { settled } = call;
    if (Result.isSuccess(settled)) {
      const result: ModelResult = { ...settled.success, duration_ms: finished - started };
      return result;
    }
    const failure = settled.failure;
    return yield* failure instanceof UnclassifiedModelError ? Effect.die(failure) : Effect.fail(failure);
  });
  return { admit: (request) => Effect.asVoid(admitted(request)), generate };
}
