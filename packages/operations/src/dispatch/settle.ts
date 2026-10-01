import { Cause, Effect } from 'effect';

import { cancelled, type Outcome, type Settled } from '../outcome/outcome.ts';
import { failureOf } from './error-boundary.ts';
import type { IncidentReporter } from './incident-reporter.ts';

function stoppedWhenAborted(signal: AbortSignal): Effect.Effect<Settled> {
  return Effect.callback<Settled>((resume) => {
    const cancel = () => {
      resume(Effect.succeed(cancelled()));
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
    }
    return Effect.sync(() => {
      signal.removeEventListener('abort', cancel);
    });
  });
}

export function settle<R>(
  call: Effect.Effect<Outcome, never, R>,
  signal?: AbortSignal,
): Effect.Effect<Settled, never, R | IncidentReporter> {
  const settled: Effect.Effect<Settled, never, R | IncidentReporter> = call.pipe(
    Effect.catchCause((cause): Effect.Effect<Settled, never, IncidentReporter> =>
      Cause.hasInterruptsOnly(cause) ? Effect.succeed(cancelled()) : failureOf(cause),
    ),
  );
  return signal === undefined ? settled : settled.pipe(Effect.raceFirst(stoppedWhenAborted(signal)));
}
