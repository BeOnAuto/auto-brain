import { Effect } from 'effect';

import type { Registration } from '../definition/registration.ts';
import { Ledger } from '../ledger/ledger.ts';
import type { Outcome, Rejected } from '../outcome/outcome.ts';
import { authorizeBrainCall, authorizeOrgCall, confirmBrainExists, confirmOrgExists } from './authorization.ts';
import { runInBrain } from './brain-binding.ts';
import { withoutDispatcherServices, type DispatcherServices } from './dispatcher-services.ts';
import { withErrorBoundary } from './error-boundary.ts';
import { runInOrg } from './org-binding.ts';
import type { BrainRequest, OrgRequest } from './request.ts';

export type PipelineStep = (
  registration: Registration,
  request: OrgRequest | BrainRequest,
) => Effect.Effect<void, Rejected>;

export interface Dispatcher {
  readonly dispatchToOrg: (
    registration: Registration<'org'>,
    request: OrgRequest,
  ) => Effect.Effect<Outcome, never, DispatcherServices>;
  readonly dispatchToBrain: (
    registration: Registration<'brain'>,
    request: BrainRequest,
  ) => Effect.Effect<Outcome, never, DispatcherServices>;
}

export function makeDispatcher(steps: readonly PipelineStep[]): Dispatcher {
  const passSteps = (registration: Registration, request: OrgRequest | BrainRequest) =>
    Effect.forEach(steps, (step) => step(registration, request), { discard: true });
  return {
    dispatchToOrg: (registration, request) =>
      withErrorBoundary(
        Effect.gen(function* () {
          yield* authorizeOrgCall(registration, request);
          yield* confirmOrgExists(request);
          yield* passSteps(registration, request);
          const ledger = yield* Ledger;
          return yield* runInOrg(registration, request, ledger).pipe(withoutDispatcherServices);
        }),
        { operation: registration.name, org: request.org, caller: request.caller.id },
      ),
    dispatchToBrain: (registration, request) =>
      withErrorBoundary(
        Effect.gen(function* () {
          yield* authorizeBrainCall(registration, request);
          yield* confirmBrainExists(request);
          yield* passSteps(registration, request);
          const ledger = yield* Ledger;
          return yield* runInBrain(registration, request, ledger).pipe(withoutDispatcherServices);
        }),
        { operation: registration.name, org: request.org, brain: request.brain, caller: request.caller.id },
      ),
  };
}
