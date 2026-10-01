import { Clock, Effect, Result } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { ModelResult } from '../model/model-result.ts';
import { checkedRequest } from '../model/request-checks.ts';
import { settledCall } from './call-settling.ts';
import type { ModelResolution } from './model-resolution.ts';
import { UnclassifiedModelError } from './unclassified-model-error.ts';

export function generation(
  resolve: ModelResolution,
  configured: readonly string[],
): (request: ModelRequest) => Effect.Effect<ModelResult, ModelFailure> {
  return Effect.fnUntraced(function* (request: ModelRequest) {
    yield* checkedRequest(request);
    const target = yield* Effect.fromResult(resolve(request.model));
    const started = yield* Clock.currentTimeMillis;
    const settled = yield* Effect.promise((interruption: Readonly<AbortSignal>) =>
      settledCall(target, request, interruption, configured),
    );
    const finished = yield* Clock.currentTimeMillis;
    if (Result.isSuccess(settled)) {
      const result: ModelResult = { ...settled.success, duration_ms: finished - started };
      return result;
    }
    const failure = settled.failure;
    return yield* failure instanceof UnclassifiedModelError ? Effect.die(failure) : Effect.fail(failure);
  });
}
