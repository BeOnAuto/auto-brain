import { Cause, Clock, Effect, Exit, Fiber, Random, type Scope } from 'effect';

import { logWorkerNotStarted, logWorkerStarted, logWorkerStopped } from './logging.ts';

export type StartWorker = (onFailure: (detail: string) => void) => Effect.Effect<void, unknown, Scope.Scope>;

export interface Backoff {
  readonly firstMs: number;
  readonly mostMs: number;
  readonly steadyAfterMs: number;
}

export interface SupervisedWorker {
  readonly stop: () => Promise<void>;
}

export const workerBackoff: Backoff = { firstMs: 1000, mostMs: 30_000, steadyAfterMs: 60_000 };

const workerStopDeadlineMs = 11_000;

type Attempt =
  | { readonly started: false; readonly detail: string }
  | { readonly started: true; readonly detail: string; readonly ranForMs: number };

export function retryDelayMs(failures: number, fraction: number, backoff: Backoff = workerBackoff): number {
  const ceiling = Math.min(backoff.mostMs, backoff.firstMs * 2 ** (failures - 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * fraction);
}

export function superviseWorker(start: StartWorker, backoff: Backoff = workerBackoff): Effect.Effect<never> {
  const supervise = (failures: number): Effect.Effect<never> =>
    Effect.gen(function* () {
      const attempt = yield* attemptToRun(start);
      const counted = attempt.started && attempt.ranForMs >= backoff.steadyAfterMs ? 1 : failures + 1;
      const delayMs = retryDelayMs(counted, yield* Random.next, backoff);
      yield* attempt.started ? logWorkerStopped(attempt.detail, delayMs) : logWorkerNotStarted(attempt.detail, delayMs);
      yield* Effect.sleep(delayMs);
      return yield* supervise(counted);
    });
  return supervise(0);
}

export function runSupervised(
  supervised: Effect.Effect<never>,
  stopDeadlineMs = workerStopDeadlineMs,
): SupervisedWorker {
  const fiber = Effect.runFork(supervised);
  return {
    stop: () => Effect.runPromise(Fiber.interrupt(fiber).pipe(Effect.timeoutOption(stopDeadlineMs), Effect.asVoid)),
  };
}

function attemptToRun(start: StartWorker): Effect.Effect<Attempt> {
  const running = Effect.scoped(
    Effect.gen(function* () {
      const stopped = Promise.withResolvers<string>();
      yield* start(stopped.resolve);
      yield* logWorkerStarted;
      const startedAt = yield* Clock.currentTimeMillis;
      const detail = yield* Effect.promise(() => stopped.promise);
      return { detail, ranForMs: (yield* Clock.currentTimeMillis) - startedAt };
    }),
  );
  return Effect.gen(function* () {
    const ran = yield* Effect.exit(running);
    return Exit.isSuccess(ran)
      ? { started: true, ...ran.value }
      : { started: false, detail: detailOf(Cause.squash(ran.cause)) };
  });
}

function detailOf(failure: unknown): string {
  const detail: unknown = typeof failure === 'object' && failure !== null ? Reflect.get(failure, 'detail') : undefined;
  return typeof detail === 'string' ? detail : String(failure);
}
