import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import { Effect, Exit, Option } from 'effect';

export function inRuntime<A, E>(
  runtime: AppRuntime<DispatcherServices>,
  work: Effect.Effect<A, E, DispatcherServices>,
): Effect.Effect<A, E> {
  return Effect.gen(function* () {
    const parent = yield* Effect.option(Effect.currentParentSpan);
    const traced = Option.isSome(parent) ? Effect.withParentSpan(work, parent.value) : work;
    const ran = yield* Effect.promise((signal) => runtime.run(Effect.exit(traced), signal));
    if (!Exit.isExit(ran)) {
      return yield* Effect.die(new Error('The server stopped before the work could be done'));
    }
    return yield* ran;
  });
}
