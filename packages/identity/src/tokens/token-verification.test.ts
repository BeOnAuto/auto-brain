import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { claimedIssuerOf, mostTokenBytes } from './token-verification.ts';

function segmentOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const header = segmentOf({ alg: 'RS256', kid: 'rs256-1', typ: 'at+jwt' });

const payload = segmentOf({ iss: 'https://login.example', aud: 'https://runtime.example', exp: 1, sub: 'ada' });

function tokenOf(length: number): string {
  return `${header}.${payload}.${'A'.repeat(length - header.length - payload.length - 2)}`;
}

describe('the issuer a token claims', () => {
  it('is read from a token of 8 KiB, and a token one byte longer is refused before anything is decoded', () => {
    expect([tokenOf(mostTokenBytes).length, claimedIssuerOf(tokenOf(mostTokenBytes))]).toEqual([
      8192,
      Result.succeed('https://login.example'),
    ]);
    expect(claimedIssuerOf(tokenOf(mostTokenBytes + 1))).toEqual(Result.fail('it is longer than 8 KiB'));
  });
});
