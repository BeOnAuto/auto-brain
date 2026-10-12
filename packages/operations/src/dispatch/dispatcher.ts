import { Effect } from 'effect';

import {
  authorizeBrainCall,
  authorizeOrgCall,
  confirmBrainTakesCall,
  confirmOrgExists,
} from '../authorization/authorization.ts';
import type { Registration, Runnable } from '../definition/registration.ts';
import { Ledger } from '../ledger/ledger.ts';
import type { Outcome, Rejected, Succeeded } from '../outcome/outcome.ts';
import { runInBrain } from './brain-binding.ts';
import { withoutDispatcherServices, type DispatcherServices } from './dispatcher-services.ts';
import { withErrorBoundary } from './error-boundary.ts';
import { runInOrg } from './org-binding.ts';
import type { BrainRequest, OrgRequest } from './request.ts';

export type PipelineStep = (
  registration: Runnable,
  request: OrgRequest | BrainRequest,
) => Effect.Effect<void, Rejected>;

export interface Dispatcher {
  dispatchToOrg(
    registration: Registration<'org'>,
    request: OrgRequest,
  ): Effect.Effect<Outcome, never, DispatcherServices>;
  dispatchToOrg(
    registration: Runnable<'org'>,
    request: OrgRequest,
  ): Effect.Effect<Outcome<Succeeded>, never, DispatcherServices>;
  dispatchToBrain(
    registration: Registration<'brain'>,
    request: BrainRequest,
  ): Effect.Effect<Outcome, never, DispatcherServices>;
  dispatchToBrain(
    registration: Runnable<'brain'>,
    request: BrainRequest,
  ): Effect.Effect<Outcome<Succeeded>, never, DispatcherServices>;
}

export function makeDispatcher(steps: readonly PipelineStep[]): Dispatcher {
  const passSteps = (registration: Runnable, request: OrgRequest | BrainRequest) =>
    Effect.forEach(steps, (step) => step(registration, request), { discard: true });
  return {
    dispatchToOrg: <A extends Succeeded>(registration: Runnable<'org', A>, request: OrgRequest) =>
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
    dispatchToBrain: <A extends Succeeded>(registration: Runnable<'brain', A>, request: BrainRequest) =>
      withErrorBoundary(
        Effect.gen(function* () {
          yield* authorizeBrainCall(registration, request);
          yield* confirmBrainTakesCall(registration, request);
          yield* passSteps(registration, request);
          const ledger = yield* Ledger;
          return yield* runInBrain(registration, request, ledger).pipe(withoutDispatcherServices);
        }),
        { operation: registration.name, org: request.org, brain: request.brain, caller: request.caller.id },
      ),
  };
}
