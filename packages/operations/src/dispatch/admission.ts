import { Effect, Predicate } from 'effect';

import { mayReachBrain } from '../caller/brain-access.ts';
import type { CallerIdentity } from '../caller/caller.ts';
import { isBrainId, isOrgId } from '../caller/identifiers.ts';
import { permissionFor } from '../caller/permission.ts';
import type { Registration } from '../definition/registration.ts';
import { BrainDirectory } from '../ledger/brain-directory.ts';
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

function rejectionOfBrainReach({ brains }: CallerIdentity, brain: unknown): Rejected | undefined {
  return mayReachBrain(brains, brain) ? undefined : rejected('forbidden', 'The caller may not reach this brain');
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

export function admitToOrg(registration: Registration<'org'>, request: OrgRequest): Effect.Effect<void, Rejected> {
  return failWith(
    rejectionOfCaller(registration, request) ??
      (registration.addressesBrain ? rejectionOfBrainReach(request.caller, brainFieldOf(request.input)) : undefined) ??
      rejectionOfOrgId(request.org),
  );
}

export const admitToBrain = Effect.fnUntraced(function* (registration: Registration<'brain'>, request: BrainRequest) {
  const { caller, org, brain } = request;
  yield* failWith(
    rejectionOfCaller(registration, request) ??
      rejectionOfBrainReach(caller, brain) ??
      rejectionOfOrgId(org) ??
      rejectionOfBrainId(brain),
  );
  const exists = yield* (yield* BrainDirectory).exists({ org, brain });
  return yield* failWith(exists ? undefined : rejected('not_found', `There is no brain ${brain} in this org`));
});
