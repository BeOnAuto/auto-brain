import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IssuerFetch } from '../index.ts';
import { fakeIssuer, signedTokens, type FakeIssuer } from '../testing/index.ts';

const startedAt = Date.parse('2026-10-13T09:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(startedAt);
});

afterEach(() => {
  vi.useRealTimers();
});

function after(milliseconds: number): void {
  vi.setSystemTime(startedAt + milliseconds);
}

interface Unreachable {
  readonly fetch: IssuerFetch;
  readonly cut: () => void;
}

function cutAfterStart(fake: FakeIssuer): Unreachable {
  let reachable = true;
  return {
    fetch: (request) => (reachable ? fake.answer(request) : Promise.reject(new TypeError('fetch failed'))),
    cut: () => {
      reachable = false;
    },
  };
}

const noKey = { because: 'ERR_JWKS_NO_MATCHING_KEY' };

describe('the key set of an issuer', () => {
  it('is read at start, and again for an unknown kid only once a minute has passed since the last read', async () => {
    const fake = fakeIssuer('https://login.example');
    const { issuers, token } = await signedTokens(fake);
    const unknown = await token({}, { kid: 'unknown' });
    after(1000);
    const early = await issuers.personOf(unknown, '/mcp');
    after(61_000);
    const late = await issuers.personOf(unknown, '/mcp');

    expect([early, late]).toEqual([noKey, noKey]);
    expect(fake.keySetReads()).toBe(2);
  });

  it('is read once for unknown kids that arrive together', async () => {
    const fake = fakeIssuer('https://login.example');
    const { issuers, token } = await signedTokens(fake);
    const unknown = await token({}, { kid: 'unknown' });
    after(61_000);

    expect(await Promise.all([1, 2, 3].map(() => issuers.personOf(unknown, '/mcp')))).toEqual([noKey, noKey, noKey]);
    expect(fake.keySetReads()).toBe(2);
  });

  it('is read again for the kid of a rotated key, which then verifies', async () => {
    const fake = fakeIssuer('https://login.example');
    const { token, callerOf } = await signedTokens(fake);
    fake.rotate();
    after(61_000);

    expect(await callerOf(await token())).toBe('person:corp/ada');
    expect(fake.keySetReads()).toBe(2);
  });

  it('keeps the keys it holds when it cannot be read again', async () => {
    const fake = fakeIssuer('https://login.example');
    const network = cutAfterStart(fake);
    const { issuers, token, callerOf } = await signedTokens(fake, { fetch: network.fetch });
    network.cut();
    after(61_000);

    expect(await issuers.personOf(await token({}, { kid: 'unknown' }), '/mcp')).toEqual({
      because: 'the key set of its issuer could not be read',
    });
    expect(await callerOf(await token())).toBe('person:corp/ada');
  });
});
