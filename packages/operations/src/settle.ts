import { Cause, Effect } from 'effect';

import { faultOf } from './fault-boundary.ts';
import type { IncidentReporter } from './incident-reporter.ts';
import { stopped, type Outcome, type Settled } from './outcome.ts';

function stoppedWhenAborted(signal: AbortSignal): Effect.Effect<Settled> {
  return Effect.callback<Settled>((resume) => {
    const stop = () => {
      resume(Effect.succeed(stopped()));
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) {
      stop();
    }
    return Effect.sync(() => {
      signal.removeEventListener('abort', stop);
    });
  });
}

export function settle<R>(
  call: Effect.Effect<Outcome, never, R>,
  signal?: AbortSignal,
): Effect.Effect<Settled, never, R | IncidentReporter> {
  const settled: Effect.Effect<Settled, never, R | IncidentReporter> = call.pipe(
    Effect.catchCause((cause): Effect.Effect<Settled, never, IncidentReporter> =>
      Cause.hasInterruptsOnly(cause) ? Effect.succeed(stopped()) : faultOf(cause),
    ),
  );
  return signal === undefined ? settled : settled.pipe(Effect.raceFirst(stoppedWhenAborted(signal)));
}
