import { Effect, Predicate } from 'effect';

import { mayReachBrain } from '../caller/brain-access.ts';
import type { CallerIdentity } from '../caller/caller.ts';
import { isBrainId, isOrgId } from '../caller/identifiers.ts';
import { permissionFor } from '../caller/permission.ts';
import type { Registration } from '../definition/registration.ts';
import { BrainDirectory } from '../ledger/brain-directory.ts';
import { refused, type Refused } from '../outcome/outcome.ts';
import type { BrainRequest, OrgRequest } from './request.ts';

function refusalOfCaller(registration: Registration, { caller, org }: OrgRequest): Refused | undefined {
  if (caller.org !== org) {
    return refused('forbidden', 'The caller does not belong to this org');
  }
  const permission = permissionFor(registration.kind, registration.scope);
  return caller.permissions.includes(permission)
    ? undefined
    : refused('forbidden', `The caller lacks the ${permission} permission`);
}

function refusalOfBrainReach({ brains }: CallerIdentity, brain: unknown): Refused | undefined {
  return mayReachBrain(brains, brain) ? undefined : refused('forbidden', 'The caller may not reach this brain');
}

function refusalOfOrgId(org: string): Refused | undefined {
  return isOrgId(org) ? undefined : refused('not_found', 'There is no such org');
}

function refusalOfBrainId(brain: string): Refused | undefined {
  return isBrainId(brain) ? undefined : refused('not_found', 'There is no such brain in this org');
}

function brainFieldOf(input: unknown): unknown {
  return Predicate.hasProperty(input, 'brain') ? input.brain : undefined;
}

function failWith(refusal: Refused | undefined): Effect.Effect<void, Refused> {
  return refusal === undefined ? Effect.void : Effect.fail(refusal);
}

export function admitToOrg(registration: Registration<'org'>, request: OrgRequest): Effect.Effect<void, Refused> {
  return failWith(
    refusalOfCaller(registration, request) ??
      (registration.addressesBrain ? refusalOfBrainReach(request.caller, brainFieldOf(request.input)) : undefined) ??
      refusalOfOrgId(request.org),
  );
}

export const admitToBrain = Effect.fnUntraced(function* (registration: Registration<'brain'>, request: BrainRequest) {
  const { caller, org, brain } = request;
  yield* failWith(
    refusalOfCaller(registration, request) ??
      refusalOfBrainReach(caller, brain) ??
      refusalOfOrgId(org) ??
      refusalOfBrainId(brain),
  );
  const exists = yield* (yield* BrainDirectory).exists({ org, brain });
  return yield* failWith(exists ? undefined : refused('not_found', `There is no brain ${brain} in this org`));
});
