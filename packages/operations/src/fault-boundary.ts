import { randomUUIDv7 } from 'node:crypto';

import { Cause, Effect, Predicate } from 'effect';

import { IncidentReporter, type CallSummary, type Incident } from './incident-reporter.ts';
import { faulted, type Done, type Faulted, type Outcome, type Refused } from './outcome.ts';

const reporterPatience = '2 seconds';

function incidentOf(id: string, cause: Cause.Cause<unknown>, call: CallSummary | undefined): Incident {
  const original = Cause.squash(cause);
  return call === undefined ? { id, original } : { id, original, call };
}

export const faultOf = Effect.fnUntraced(function* (cause: Cause.Cause<unknown>, call?: CallSummary) {
  const id = randomUUIDv7();
  const reporter = yield* IncidentReporter;
  yield* Effect.suspend(() => reporter.report(incidentOf(id, cause, call))).pipe(
    Effect.timeout(reporterPatience),
    Effect.catchCause(() => Effect.logError(`The incident reporter did not record incident ${id}`)),
  );
  const fault: Faulted = faulted(id);
  return fault;
});

export function concluded<R>(
  pipeline: Effect.Effect<Done, Refused, R>,
  summary: CallSummary,
): Effect.Effect<Outcome, never, R | IncidentReporter> {
  return pipeline.pipe(
    Effect.catch((refusal) => Effect.succeed(refusal)),
    Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), (cause) => faultOf(cause, summary)),
  );
}
