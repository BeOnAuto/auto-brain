import {
  allPermissions,
  holdsNoForbiddenCharacter,
  mostReferenceBytes,
  type CallerIdentity,
  type PlaybookAccess,
} from '@on.auto/operations';
import { Option, Predicate, Result, Schema } from 'effect';

import type { Principal } from '../access/principal.ts';
import { isWithinTheSubjectBound, type Payload } from '../tokens/token-verification.ts';
import type { IdentityProvider } from './identity-providers-setting.ts';

type Grant = IdentityProvider['grants']['by'][string];

const decodeClaimValues = Schema.decodeUnknownOption(Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]));

const decodeSubject = Schema.decodeUnknownOption(
  Schema.NonEmptyString.check(Schema.makeFilter(holdsNoForbiddenCharacter)),
);

function valuesOf(claim: unknown): readonly string[] {
  return Option.match(decodeClaimValues(claim), {
    onNone: () => [],
    onSome: (values) =>
      typeof values === 'string' ? values.split(/\s+/u) : values.filter((value) => Predicate.isString(value)),
  });
}

function playbooksOf(grants: readonly Grant[]): PlaybookAccess {
  const listed = grants.map(({ playbooks }) => playbooks);
  return listed.includes('*') ? '*' : [...new Set(listed.flat())];
}

function grantsOf({ membership, grants }: IdentityProvider, payload: Payload): readonly Grant[] {
  if (membership !== undefined && !valuesOf(payload[membership.claim]).includes(membership.value)) {
    return [];
  }
  const byValue = new Map(Object.entries(grants.by));
  return valuesOf(payload[grants.claim]).flatMap((value) => byValue.get(value) ?? []);
}

function callerOf(provider: IdentityProvider, payload: Payload): readonly CallerIdentity[] {
  const subject = decodeSubject(payload[provider.subject ?? 'sub']);
  const grants = grantsOf(provider, payload);
  const permissions = allPermissions.filter((permission) =>
    grants.some((grant) => grant.permissions.includes(permission)),
  );
  return Option.isSome(subject) && permissions.length > 0
    ? [
        {
          id: `person:${provider.name}/${subject.value}`,
          org: provider.org,
          permissions,
          playbooks: playbooksOf(grants),
        },
      ]
    : [];
}

function overlongSubjectClaimOf(providers: readonly IdentityProvider[], payload: Payload): string | undefined {
  return providers
    .map(({ subject = 'sub' }) => subject)
    .find((claim) => {
      const subject = payload[claim];
      return Predicate.isString(subject) && !isWithinTheSubjectBound(subject);
    });
}

function principalOf(callers: readonly CallerIdentity[]): Principal {
  return {
    org: callers[0]?.org,
    callerIn: (org) => callers.find((caller) => caller.org === org),
  };
}

export function admittedPerson(
  providers: readonly IdentityProvider[],
  payload: Payload,
): Result.Result<Principal, string> {
  const overlong = overlongSubjectClaimOf(providers, payload);
  return overlong === undefined
    ? Result.succeed(principalOf(providers.flatMap((provider) => callerOf(provider, payload))))
    : Result.fail(`its claim ${overlong} holds a subject of more than ${mostReferenceBytes} bytes`);
}
