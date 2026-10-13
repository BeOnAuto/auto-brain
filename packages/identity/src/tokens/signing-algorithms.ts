import { constants, createPublicKey, verify, type KeyObject, type SigningOptions } from 'node:crypto';

import { Schema } from 'effect';

export const SigningAlgorithmSchema = Schema.Literals(['RS256', 'PS256', 'ES256', 'EdDSA']);

export type SigningAlgorithm = typeof SigningAlgorithmSchema.Type;

export const signingAlgorithms: readonly SigningAlgorithm[] = SigningAlgorithmSchema.literals;

export interface VerifyingKey {
  readonly algorithms: readonly SigningAlgorithm[];
  readonly verifies: (algorithm: SigningAlgorithm, signed: string, signature: string) => boolean;
}

interface Verification {
  readonly digest: string | null;
  readonly options: SigningOptions;
}

const verifications: Readonly<Record<SigningAlgorithm, Verification>> = {
  RS256: { digest: 'sha256', options: { padding: constants.RSA_PKCS1_PADDING } },
  PS256: { digest: 'sha256', options: { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } },
  ES256: { digest: 'sha256', options: { dsaEncoding: 'ieee-p1363' } },
  EdDSA: { digest: null, options: {} },
};

const leastRsaBits = 2048;

interface KeyDetails {
  readonly type: string | undefined;
  readonly bits: number;
  readonly curve: string | undefined;
}

function algorithmsOfKey({ type, bits, curve }: KeyDetails): readonly SigningAlgorithm[] {
  if (type === 'rsa') {
    return bits >= leastRsaBits ? ['RS256', 'PS256'] : [];
  }
  if (type === 'ec') {
    return curve === 'prime256v1' ? ['ES256'] : [];
  }
  return type === 'ed25519' || type === 'ed448' ? ['EdDSA'] : [];
}

const optionalText = Schema.optionalKey(Schema.String);

export const JwkSchema = Schema.Struct({
  kty: Schema.String,
  use: optionalText,
  alg: optionalText,
  crv: optionalText,
  n: optionalText,
  e: optionalText,
  x: optionalText,
  y: optionalText,
});

export type Jwk = typeof JwkSchema.Type;

function namedFor({ alg, use }: Jwk, algorithms: readonly SigningAlgorithm[]): readonly SigningAlgorithm[] {
  if (use !== undefined && use !== 'sig') {
    return [];
  }
  return alg === undefined ? algorithms : algorithms.filter((algorithm) => algorithm === alg);
}

function publicKeyOf(jwk: Jwk): KeyObject | undefined {
  try {
    return createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    return undefined;
  }
}

export function verifyingKeyOf(jwk: Jwk): VerifyingKey | undefined {
  const key = publicKeyOf(jwk);
  const details = key?.asymmetricKeyDetails;
  const algorithms = namedFor(
    jwk,
    algorithmsOfKey({ type: key?.asymmetricKeyType, bits: details?.modulusLength ?? 0, curve: details?.namedCurve }),
  );
  if (key === undefined || algorithms.length === 0) {
    return undefined;
  }
  return {
    algorithms,
    verifies: (algorithm, signed, signature) => {
      const { digest, options } = verifications[algorithm];
      return (
        algorithms.includes(algorithm) &&
        verify(digest, Buffer.from(signed), { key, ...options }, Buffer.from(signature, 'base64url'))
      );
    },
  };
}
