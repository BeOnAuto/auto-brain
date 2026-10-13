import { describe, expect, it } from 'vitest';

import { accessTokenOf, mostTokenBytes } from './access-token.ts';

function segmentOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const header = segmentOf({ alg: 'RS256', kid: 'rs256-1', typ: 'at+jwt' });

const payload = segmentOf({ iss: 'https://login.example', aud: 'https://runtime.example', exp: 1, sub: 'ada' });

function tokenOf(length: number): string {
  return `${header}.${payload}.${'A'.repeat(length - header.length - payload.length - 2)}`;
}

describe('an access token', () => {
  it('is read with its algorithm, its key id, the part signed, its signature, its claims and its payload', () => {
    expect(accessTokenOf(`${header}.${payload}.c2lnbmF0dXJl`)).toEqual({
      algorithm: 'RS256',
      keyId: 'rs256-1',
      signed: `${header}.${payload}`,
      signature: 'c2lnbmF0dXJl',
      claims: { iss: 'https://login.example', aud: 'https://runtime.example', exp: 1 },
      payload: { iss: 'https://login.example', aud: 'https://runtime.example', exp: 1, sub: 'ada' },
    });
  });

  it('is read at 8 KiB and refused one byte over', () => {
    expect([tokenOf(mostTokenBytes).length, accessTokenOf(tokenOf(mostTokenBytes))?.keyId]).toEqual([8192, 'rs256-1']);
    expect(accessTokenOf(tokenOf(mostTokenBytes + 1))).toBeUndefined();
  });

  it.each([
    ['segments that are not base64url', `${header}.${payload}.c2ln+bmF0dXJl`],
    ['a payload that is not UTF-8', `${header}.${Buffer.from([0xc3, 0x28]).toString('base64url')}.c2ln`],
    ['claims without an issuer', `${header}.${segmentOf({ aud: 'https://runtime.example', exp: 1 })}.c2ln`],
    ['an exp that is not a number', `${header}.${segmentOf({ iss: 'x', aud: 'y', exp: '1' })}.c2ln`],
  ])('is refused for %s', (_case, token) => {
    expect(accessTokenOf(token)).toBeUndefined();
  });
});
