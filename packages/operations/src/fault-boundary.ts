import { randomUUIDv7 } from 'node:crypto';

import { Cause, Effect, Predicate } from 'effect';

import { IncidentReporter } from './incident-reporter.ts';
import { faulted, type Outcome } from './outcome.ts';

const reportFault = Effect.fnUntraced(function* (cause: Cause.Cause<never>) {
  const incident = randomUUIDv7();
  const reporter = yield* IncidentReporter;
  yield* Effect.ignoreCause(Effect.suspend(() => reporter.report(incident, Cause.squash(cause))));
  return faulted(incident);
});

export function withFaultBoundary<R>(
  call: Effect.Effect<Outcome, never, R>,
): Effect.Effect<Outcome, never, R | IncidentReporter> {
  return call.pipe(Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), reportFault));
}
