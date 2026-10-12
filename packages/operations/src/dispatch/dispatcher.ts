import { Effect } from 'effect';

import {
  authorizePlaybookCall,
  authorizeOrgCall,
  confirmPlaybookTakesCall,
  confirmOrgExists,
} from '../authorization/authorization.ts';
import type { Registration } from '../definition/registration.ts';
import { Ledger } from '../ledger/ledger.ts';
import type { Outcome, Rejected } from '../outcome/outcome.ts';
import { withoutDispatcherServices, type DispatcherServices } from './dispatcher-services.ts';
import { withErrorBoundary } from './error-boundary.ts';
import { runInOrg } from './org-binding.ts';
import { runInPlaybook } from './playbook-binding.ts';
import type { PlaybookRequest, OrgRequest } from './request.ts';

export type PipelineStep = (
  registration: Registration,
  request: OrgRequest | PlaybookRequest,
) => Effect.Effect<void, Rejected>;

export interface Dispatcher {
  readonly dispatchToOrg: (
    registration: Registration<'org'>,
    request: OrgRequest,
  ) => Effect.Effect<Outcome, never, DispatcherServices>;
  readonly dispatchToPlaybook: (
    registration: Registration<'playbook'>,
    request: PlaybookRequest,
  ) => Effect.Effect<Outcome, never, DispatcherServices>;
}

export function makeDispatcher(steps: readonly PipelineStep[]): Dispatcher {
  const passSteps = (registration: Registration, request: OrgRequest | PlaybookRequest) =>
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
    dispatchToPlaybook: (registration, request) =>
      withErrorBoundary(
        Effect.gen(function* () {
          yield* authorizePlaybookCall(registration, request);
          yield* confirmPlaybookTakesCall(registration, request);
          yield* passSteps(registration, request);
          const ledger = yield* Ledger;
          return yield* runInPlaybook(registration, request, ledger).pipe(withoutDispatcherServices);
        }),
        { operation: registration.name, org: request.org, playbook: request.playbook, caller: request.caller.id },
      ),
  };
}
