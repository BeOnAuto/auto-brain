import {
  bytesOfReference,
  forbiddenCharactersInWords,
  holdsNoForbiddenCharacter,
  mostReferenceBytes,
} from '@on.auto/operations';
import { Predicate, Result, Schema } from 'effect';
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { CredentialOrgSchema } from '../access/local-org.ts';
import type { VerifiedPerson } from '../access/principal.ts';
import { UnreadAnswer } from '../identity-service/issuer-requests.ts';

export const mostTokenBytes = 8192;

const orgClaim = 'org_id';

const leewaySeconds = 60;

const accessTokenTypes: ReadonlySet<string> = new Set(['at+jwt', 'application/at+jwt', 'jwt', 'application/jwt']);

const signingAlgorithms = ['RS256', 'PS256', 'ES256', 'EdDSA'];

const isCredentialOrg = Schema.is(CredentialOrgSchema);

type Payload = Readonly<Record<string, unknown>>;

export interface Expected {
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly now: number;
}

function refusalOf(error: unknown): string {
  if (error instanceof errors.JOSEError) {
    return Predicate.hasProperty(error, 'claim') && Predicate.isString(error.claim)
      ? `${error.code} on its ${error.claim} claim`
      : error.code;
  }
  return error instanceof UnreadAnswer ? 'the key set of its issuer could not be read' : 'it could not be verified';
}

function typeRefusal(typ: unknown): string | undefined {
  return typ === undefined || (Predicate.isString(typ) && accessTokenTypes.has(typ.toLowerCase()))
    ? undefined
    : 'its typ is not that of an access token';
}

function isSubject(sub: unknown): sub is string {
  return Predicate.isString(sub) && sub !== '' && bytesOfReference(sub) <= mostReferenceBytes;
}

function personIn({ iat, sub, [orgClaim]: org }: Payload, now: number): string | VerifiedPerson {
  if (Predicate.isNumber(iat) && iat > now / 1000 + leewaySeconds) {
    return `its iat is more than ${leewaySeconds} seconds ahead`;
  }
  if (!isSubject(sub) || !holdsNoForbiddenCharacter(sub)) {
    return `its sub is not a non-empty string of at most ${mostReferenceBytes} bytes without ${forbiddenCharactersInWords}`;
  }
  return isCredentialOrg(org) ? { subject: sub, org } : `its ${orgClaim} claim is not an org id other than local`;
}

async function verified(token: string, keySet: JWTVerifyGetKey, expected: Expected): Promise<string | VerifiedPerson> {
  const { payload, protectedHeader } = await jwtVerify(token, keySet, {
    issuer: expected.issuer,
    audience: [...expected.audiences],
    algorithms: signingAlgorithms,
    clockTolerance: leewaySeconds,
    requiredClaims: ['exp', 'sub', orgClaim],
    currentDate: new Date(expected.now),
  });
  return typeRefusal(protectedHeader.typ) ?? personIn(payload, expected.now);
}

export async function verifiedPerson(
  token: string,
  keySet: JWTVerifyGetKey,
  expected: Expected,
): Promise<Result.Result<VerifiedPerson, string>> {
  if (token.length > mostTokenBytes) {
    return Result.fail(`it is longer than ${mostTokenBytes / 1024} KiB`);
  }
  try {
    const person = await verified(token, keySet, expected);
    return typeof person === 'string' ? Result.fail(person) : Result.succeed(person);
  } catch (error) {
    return Result.fail(refusalOf(error));
  }
}
