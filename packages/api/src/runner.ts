import type { Stopped } from '@beonauto/operations';
import { Cause, Exit, ManagedRuntime, type Effect, type Layer } from 'effect';

export interface Runner<R> {
  readonly run: <A>(effect: Effect.Effect<A, never, R>) => Promise<A | Stopped>;
  readonly dispose: () => Promise<void>;
}

const stopped: Stopped = { status: 'stopped' };

export async function makeRunner<R, E>(layer: Layer.Layer<R, E>): Promise<Runner<R>> {
  const runtime = ManagedRuntime.make(layer);
  await runtime.context();
  let disposed = false;
  return {
    run: async (effect) => {
      if (disposed) {
        return stopped;
      }
      const exit = await runtime.runPromiseExit(effect);
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      if (Cause.hasInterruptsOnly(exit.cause)) {
        return stopped;
      }
      throw new Error(Cause.pretty(exit.cause));
    },
    dispose: async () => {
      disposed = true;
      await runtime.dispose();
    },
  };
}
