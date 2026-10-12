import { Effect, Predicate } from 'effect';

import { canAccessPlaybook } from '../caller/brain-access.ts';
import type { CallerIdentity } from '../caller/caller.ts';
import { isPlaybookId, isOrgId } from '../caller/identifiers.ts';
import type { OperationKind } from '../caller/operation-scope.ts';
import type { Registration } from '../definition/registration.ts';
import type { PlaybookRequest, OrgRequest } from '../dispatch/request.ts';
import { PlaybookRegistry, type PlaybookStatus } from '../ledger/brain-registry.ts';
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

const playbookUnnamed = 'The caller may access only some playbooks of this org; name one of them in playbook';

function rejectionOfPlaybookAccess(caller: CallerIdentity, playbook: unknown): Rejected | undefined {
  if (canAccessPlaybook(caller.playbooks, playbook)) {
    return undefined;
  }
  return rejected('forbidden', playbook === undefined ? playbookUnnamed : 'The caller may not access this playbook');
}

function rejectionOfOrgId(org: string): Rejected | undefined {
  return isOrgId(org) ? undefined : rejected('not_found', 'There is no such org');
}

function rejectionOfPlaybookId(playbook: string): Rejected | undefined {
  return isPlaybookId(playbook) ? undefined : rejected('not_found', 'There is no such playbook in this org');
}

function playbookFieldOf(input: unknown): unknown {
  return Predicate.hasProperty(input, 'playbook') ? input.playbook : undefined;
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
      (registration.targetsPlaybook
        ? rejectionOfPlaybookAccess(request.caller, playbookFieldOf(request.input))
        : undefined),
  );
}

export function authorizePlaybookCall(
  registration: Registration<'playbook'>,
  request: PlaybookRequest,
): Effect.Effect<void, Rejected> {
  return failWith(
    rejectionOfCaller(registration, request) ?? rejectionOfPlaybookAccess(request.caller, request.playbook),
  );
}

export function confirmOrgExists({ org }: OrgRequest): Effect.Effect<void, Rejected> {
  return failWith(rejectionOfOrgId(org));
}

function rejectionOfPlaybookStatus(
  status: PlaybookStatus,
  kind: OperationKind,
  playbook: string,
): Rejected | undefined {
  if (status === 'unknown') {
    return rejected('not_found', `There is no playbook ${playbook} in this org`);
  }
  return status === 'retired' && kind === 'command'
    ? rejected('conflict', `The playbook ${playbook} is retired and can no longer change`, undefined, 'retired')
    : undefined;
}

export const confirmPlaybookTakesCall = Effect.fnUntraced(function* (
  { kind }: Registration<'playbook'>,
  { org, playbook }: PlaybookRequest,
) {
  yield* failWith(rejectionOfOrgId(org) ?? rejectionOfPlaybookId(playbook));
  const status = yield* (yield* PlaybookRegistry).status({ org, playbook });
  return yield* failWith(rejectionOfPlaybookStatus(status, kind, playbook));
});
