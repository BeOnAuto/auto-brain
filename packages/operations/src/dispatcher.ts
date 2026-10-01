import { Effect } from 'effect';

import { admitToBrain, admitToOrg } from './admission.ts';
import { runInBrain } from './brain-binding.ts';
import { withoutDispatcherServices, type DispatcherServices } from './dispatcher-services.ts';
import { withFaultBoundary } from './fault-boundary.ts';
import { Ledger } from './ledger.ts';
import { runInOrg } from './org-binding.ts';
import type { Done, Outcome, Refused } from './outcome.ts';
import type { Registration } from './registration.ts';
import type { BrainRequest, OrgRequest } from './request.ts';

export type PipelineStep = (
  registration: Registration,
  request: OrgRequest | BrainRequest,
) => Effect.Effect<void, Refused>;

export interface Dispatcher {
  readonly inOrg: (
    registration: Registration<'org'>,
    request: OrgRequest,
  ) => Effect.Effect<Outcome, never, DispatcherServices>;
  readonly inBrain: (
    registration: Registration<'brain'>,
    request: BrainRequest,
  ) => Effect.Effect<Outcome, never, DispatcherServices>;
}

function concluded(
  pipeline: Effect.Effect<Done, Refused, DispatcherServices>,
): Effect.Effect<Outcome, never, DispatcherServices> {
  return withFaultBoundary(pipeline.pipe(Effect.catch((refusal) => Effect.succeed(refusal))));
}

export function makeDispatcher(steps: readonly PipelineStep[]): Dispatcher {
  const passSteps = (registration: Registration, request: OrgRequest | BrainRequest) =>
    Effect.forEach(steps, (step) => step(registration, request), { discard: true });
  return {
    inOrg: (registration, request) =>
      concluded(
        Effect.gen(function* () {
          yield* admitToOrg(registration, request);
          yield* passSteps(registration, request);
          const ledger = yield* Ledger;
          return yield* runInOrg(registration, request, ledger).pipe(withoutDispatcherServices);
        }),
      ),
    inBrain: (registration, request) =>
      concluded(
        Effect.gen(function* () {
          yield* admitToBrain(registration, request);
          yield* passSteps(registration, request);
          const ledger = yield* Ledger;
          return yield* runInBrain(registration, request, ledger).pipe(withoutDispatcherServices);
        }),
      ),
  };
}
