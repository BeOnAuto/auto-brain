import { Option, Schema } from 'effect';

import { SigningAlgorithmSchema, type SigningAlgorithm } from './signing-algorithms.ts';

export const mostTokenBytes = 8192;

const accessTokenTypes: ReadonlySet<string> = new Set(['at+jwt', 'application/at+jwt', 'jwt']);

const HeaderSchema = Schema.Struct({
  alg: SigningAlgorithmSchema,
  kid: Schema.String,
  typ: Schema.optionalKey(
    Schema.String.check(Schema.makeFilter((type: string) => accessTokenTypes.has(type.toLowerCase()))),
  ),
  crit: Schema.optionalKey(Schema.Never),
});

const ClaimsSchema = Schema.Struct({
  iss: Schema.String,
  aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  exp: Schema.Finite,
  nbf: Schema.optionalKey(Schema.Finite),
  iat: Schema.optionalKey(Schema.Finite),
});

export type TokenClaims = typeof ClaimsSchema.Type;

export type Payload = Readonly<Record<string, unknown>>;

export interface AccessToken {
  readonly algorithm: SigningAlgorithm;
  readonly keyId: string;
  readonly signed: string;
  readonly signature: string;
  readonly claims: TokenClaims;
  readonly payload: Payload;
}

const decodeHeader = Schema.decodeUnknownOption(Schema.fromJsonString(HeaderSchema));

const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

const decodeClaims = Schema.decodeUnknownOption(ClaimsSchema);

const base64url = /^[A-Za-z0-9_-]+$/u;

const utf8 = new TextDecoder('utf-8', { fatal: true });

function textOf(segment: string): string {
  try {
    return utf8.decode(Buffer.from(segment, 'base64url'));
  } catch {
    return '';
  }
}

function segmentsOf(token: string): readonly [string, string, string] | undefined {
  const [header = '', payload = '', signature = '', ...rest] = token.split('.');
  return token.length <= mostTokenBytes &&
    rest.length === 0 &&
    [header, payload, signature].every((part) => base64url.test(part))
    ? [header, payload, signature]
    : undefined;
}

export function accessTokenOf(token: string): AccessToken | undefined {
  const segments = segmentsOf(token);
  if (segments === undefined) {
    return undefined;
  }
  const [header, payload, signature] = segments;
  return Option.getOrUndefined(
    Option.all({
      header: decodeHeader(textOf(header)),
      payload: decodePayload(textOf(payload)),
    }).pipe(
      Option.flatMap(({ header: { alg, kid }, payload: claimed }) =>
        Option.map(decodeClaims(claimed), (claims) => ({
          algorithm: alg,
          keyId: kid,
          signed: `${header}.${payload}`,
          signature,
          claims,
          payload: claimed,
        })),
      ),
    ),
  );
}
