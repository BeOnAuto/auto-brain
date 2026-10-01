import { Cause, Exit, ManagedRuntime, type Effect, type Layer } from 'effect';

export type Settled<A> = { readonly status: 'settled'; readonly value: A } | { readonly status: 'stopped' };

export interface Runner<R> {
  readonly run: <A>(effect: Effect.Effect<A, never, R>, signal?: AbortSignal) => Promise<Settled<A>>;
  readonly dispose: () => Promise<void>;
}

const stopped: Settled<never> = { status: 'stopped' };

export async function makeRunner<R, E>(layer: Layer.Layer<R, E>): Promise<Runner<R>> {
  const runtime = ManagedRuntime.make(layer);
  await runtime.context();
  let disposed = false;
  return {
    run: async (effect, signal) => {
      if (disposed) {
        return stopped;
      }
      const exit = await runtime.runPromiseExit(effect, { signal });
      if (Exit.isSuccess(exit)) {
        return { status: 'settled', value: exit.value };
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
