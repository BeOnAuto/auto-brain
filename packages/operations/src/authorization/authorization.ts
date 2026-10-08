import { Effect, Predicate } from 'effect';

import { canAccessBrain } from '../caller/brain-access.ts';
import type { CallerIdentity } from '../caller/caller.ts';
import { isBrainId, isOrgId } from '../caller/identifiers.ts';
import type { OperationKind } from '../caller/operation-scope.ts';
import type { Registration } from '../definition/registration.ts';
import type { BrainRequest, OrgRequest } from '../dispatch/request.ts';
import { BrainRegistry, type BrainStatus } from '../ledger/brain-registry.ts';
import { rejected, type Rejected } from '../outcome/outcome.ts';
import { alternatives } from '../plain-language/phrasing.ts';

function rejectionOfCaller(registration: Registration, { caller, org }: OrgRequest): Rejected | undefined {
  if (caller.org !== org) {
    return rejected('forbidden', 'The caller does not belong to this org');
  }
  const { permissions } = registration;
  return permissions.some((permission) => caller.permissions.includes(permission))
    ? undefined
    : rejected('forbidden', `The caller lacks the ${alternatives(permissions)} permission`);
}

function rejectionOfBrainAccess(caller: CallerIdentity, brain: unknown): Rejected | undefined {
  return canAccessBrain(caller.brains, brain)
    ? undefined
    : rejected('forbidden', 'The caller may not access this brain');
}

function rejectionOfOrgId(org: string): Rejected | undefined {
  return isOrgId(org) ? undefined : rejected('not_found', 'There is no such org');
}

function rejectionOfBrainId(brain: string): Rejected | undefined {
  return isBrainId(brain) ? undefined : rejected('not_found', 'There is no such brain in this org');
}

function brainFieldOf(input: unknown): unknown {
  return Predicate.hasProperty(input, 'brain') ? input.brain : undefined;
}

function failWith(rejection: Rejected | undefined): Effect.Effect<void, Rejected> {
  return rejection === undefined ? Effect.void : Effect.fail(rejection);
}

export function authorizeOrgCall(
  registration: Registration<'org'>,
  request: OrgRequest,
): Effect.Effect<void, Rejected> {
  return failWith(
    rejectionOfCaller(registration, request) ??
      (registration.targetsBrain ? rejectionOfBrainAccess(request.caller, brainFieldOf(request.input)) : undefined),
  );
}

export function authorizeBrainCall(
  registration: Registration<'brain'>,
  request: BrainRequest,
): Effect.Effect<void, Rejected> {
  return failWith(rejectionOfCaller(registration, request) ?? rejectionOfBrainAccess(request.caller, request.brain));
}

export function confirmOrgExists({ org }: OrgRequest): Effect.Effect<void, Rejected> {
  return failWith(rejectionOfOrgId(org));
}

function rejectionOfBrainStatus(status: BrainStatus, kind: OperationKind, brain: string): Rejected | undefined {
  if (status === 'unknown') {
    return rejected('not_found', `There is no brain ${brain} in this org`);
  }
  return status === 'retired' && kind === 'command'
    ? rejected('conflict', `The brain ${brain} is retired and can no longer change`, undefined, 'retired')
    : undefined;
}

export const confirmBrainTakesCall = Effect.fnUntraced(function* (
  { kind }: Registration<'brain'>,
  { org, brain }: BrainRequest,
) {
  yield* failWith(rejectionOfOrgId(org) ?? rejectionOfBrainId(brain));
  const status = yield* (yield* BrainRegistry).status({ org, brain });
  return yield* failWith(rejectionOfBrainStatus(status, kind, brain));
});
