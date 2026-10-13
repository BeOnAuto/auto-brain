import { bytesOfReference, mostReferenceBytes } from '@on.auto/operations';
import { Predicate, Result } from 'effect';
import { decodeJwt, decodeProtectedHeader, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const mostTokenBytes = 8192;

const leewaySeconds = 60;

const accessTokenTypes: ReadonlySet<string> = new Set(['at+jwt', 'application/at+jwt', 'jwt', 'application/jwt']);

const signingAlgorithms = ['RS256', 'PS256', 'ES256', 'EdDSA'];

export type Payload = Readonly<Record<string, unknown>>;

export interface Expected {
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly now: number;
}

export function isWithinTheSubjectBound(subject: string): boolean {
  return bytesOfReference(subject) <= mostReferenceBytes;
}

function refusalOf(error: unknown): string {
  if (!(error instanceof errors.JOSEError)) {
    return 'the key set of its issuer could not be read';
  }
  return Predicate.hasProperty(error, 'claim') && Predicate.isString(error.claim)
    ? `${error.code} on its ${error.claim} claim`
    : error.code;
}

export function claimedIssuerOf(token: string): Result.Result<string, string> {
  if (token.length > mostTokenBytes) {
    return Result.fail(`it is longer than ${mostTokenBytes / 1024} KiB`);
  }
  return Result.flatMap(Result.try({ try: (): unknown => decodeJwt(token).iss, catch: refusalOf }), (iss) =>
    Predicate.isString(iss) ? Result.succeed(iss) : Result.fail('it names no iss'),
  );
}

function typeRefusal(token: string): string | undefined {
  const { typ } = decodeProtectedHeader(token);
  return typ === undefined || accessTokenTypes.has(typ.toLowerCase())
    ? undefined
    : 'its typ is not that of an access token';
}

function claimsRefusal({ iat, sub }: Payload, now: number): string | undefined {
  if (Predicate.isNumber(iat) && iat > now / 1000 + leewaySeconds) {
    return `its iat is more than ${leewaySeconds} seconds ahead`;
  }
  return Predicate.isString(sub) && sub !== '' && isWithinTheSubjectBound(sub)
    ? undefined
    : `its sub is not a non-empty string of at most ${mostReferenceBytes} bytes`;
}

async function verified(token: string, keySet: JWTVerifyGetKey, expected: Expected): Promise<string | Payload> {
  const { payload } = await jwtVerify(token, keySet, {
    issuer: expected.issuer,
    audience: [...expected.audiences],
    algorithms: signingAlgorithms,
    clockTolerance: leewaySeconds,
    requiredClaims: ['exp', 'sub'],
    currentDate: new Date(expected.now),
  });
  return claimsRefusal(payload, expected.now) ?? payload;
}

export async function verifiedPayload(
  token: string,
  keySet: JWTVerifyGetKey,
  expected: Expected,
): Promise<Result.Result<Payload, string>> {
  try {
    const refusal = typeRefusal(token) ?? (await verified(token, keySet, expected));
    return typeof refusal === 'string' ? Result.fail(refusal) : Result.succeed(refusal);
  } catch (error) {
    return Result.fail(refusalOf(error));
  }
}
