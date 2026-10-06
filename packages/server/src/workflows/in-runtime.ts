import type { AppRuntime } from '@beonauto/api';
import type { DispatcherServices } from '@beonauto/operations';
import { Effect, Exit } from 'effect';

export function inRuntime<A, E>(
  runtime: AppRuntime<DispatcherServices>,
  work: Effect.Effect<A, E, DispatcherServices>,
): Effect.Effect<A, E> {
  return Effect.gen(function* () {
    const ran = yield* Effect.promise((signal) => runtime.run(Effect.exit(work), signal));
    if (!Exit.isExit(ran)) {
      return yield* Effect.die(new Error('The server stopped before the work could be done'));
    }
    return yield* ran;
  });
}
