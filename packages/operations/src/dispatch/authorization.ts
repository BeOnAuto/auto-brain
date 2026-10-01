import { Effect, Predicate } from 'effect';

import { canAccessBrain } from '../caller/brain-access.ts';
import type { CallerIdentity } from '../caller/caller.ts';
import { isBrainId, isOrgId } from '../caller/identifiers.ts';
import { permissionFor } from '../caller/permission.ts';
import type { Registration } from '../definition/registration.ts';
import { BrainRegistry } from '../ledger/brain-registry.ts';
import { rejected, type Rejected } from '../outcome/outcome.ts';
import type { BrainRequest, OrgRequest } from './request.ts';

function rejectionOfCaller(registration: Registration, { caller, org }: OrgRequest): Rejected | undefined {
  if (caller.org !== org) {
    return rejected('forbidden', 'The caller does not belong to this org');
  }
  const permission = permissionFor(registration.kind, registration.scope);
  return caller.permissions.includes(permission)
    ? undefined
    : rejected('forbidden', `The caller lacks the ${permission} permission`);
}

function rejectionOfBrainAccess({ brains }: CallerIdentity, brain: unknown): Rejected | undefined {
  return canAccessBrain(brains, brain) ? undefined : rejected('forbidden', 'The caller may not access this brain');
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

export const confirmBrainExists = Effect.fnUntraced(function* ({ org, brain }: BrainRequest) {
  yield* failWith(rejectionOfOrgId(org) ?? rejectionOfBrainId(brain));
  const exists = yield* (yield* BrainRegistry).exists({ org, brain });
  return yield* failWith(exists ? undefined : rejected('not_found', `There is no brain ${brain} in this org`));
});
