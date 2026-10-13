import { generateKeyPairSync, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyingKeyOf, type Jwk } from './signing-algorithms.ts';

interface Pair {
  readonly publicKey: KeyObject;
}

function jwkOf(generated: () => Pair, extra: Readonly<Record<string, string>> = {}): Jwk {
  return { kty: '', ...generated().publicKey.export({ format: 'jwk' }), ...extra };
}

const rsaKey = generateKeyPairSync('rsa', { modulusLength: 2048 });

const rsa = (): Pair => rsaKey;

describe('the algorithms a key of a key set verifies', () => {
  it.each([
    ['an RSA key of 2048 bits', jwkOf(rsa), ['RS256', 'PS256']],
    ['an RSA key named for PS256', jwkOf(rsa, { alg: 'PS256' }), ['PS256']],
    ['an RSA key for signatures', jwkOf(rsa, { use: 'sig' }), ['RS256', 'PS256']],
    ['a P-256 key', jwkOf(() => generateKeyPairSync('ec', { namedCurve: 'prime256v1' })), ['ES256']],
    ['an Ed25519 key', jwkOf(() => generateKeyPairSync('ed25519')), ['EdDSA']],
    ['an Ed448 key', jwkOf(() => generateKeyPairSync('ed448')), ['EdDSA']],
  ])('are those of %s', (_case, jwk: Jwk, algorithms: readonly string[]) => {
    expect(verifyingKeyOf(jwk)?.algorithms).toEqual(algorithms);
  });

  it.each([
    ['an RSA key of 1024 bits', jwkOf(() => generateKeyPairSync('rsa', { modulusLength: 1024 }))],
    ['an RSA key for encryption', jwkOf(rsa, { use: 'enc' })],
    ['an RSA key named for another algorithm', jwkOf(rsa, { alg: 'RS512' })],
    ['a P-384 key', jwkOf(() => generateKeyPairSync('ec', { namedCurve: 'secp384r1' }))],
    ['an X25519 key', jwkOf(() => generateKeyPairSync('x25519'))],
    ['a shared secret', { kty: 'oct' }],
  ])('are none for %s', (_case, jwk: Jwk) => {
    expect(verifyingKeyOf(jwk)).toBeUndefined();
  });

  it('verify no signature under an algorithm the key does not verify', () => {
    expect(verifyingKeyOf(jwkOf(rsa, { alg: 'PS256' }))?.verifies('RS256', 'a.b', 'c2ln')).toBe(false);
  });
});
