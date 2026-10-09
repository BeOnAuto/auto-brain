import { describe, expect, it } from 'vitest';

import { awsCredentialChain, googleAccessTokens, googleCredentialChain, guarded } from './credential-sources.ts';
import { OutboundFailure } from './outbound-failure.ts';

const disabledProxy = { enabled: false, environment: {} };
const enabledProxy = {
  enabled: true,
  environment: { HTTPS_PROXY: 'http://proxy.internal:3128', NO_PROXY: '169.254.169.254' },
};

describe('guarded', () => {
  it('passes a credential through', async () => {
    await expect(guarded(() => Promise.resolve('credential'))()).resolves.toBe('credential');
  });

  it('replaces any failure with one that carries nothing from it', async () => {
    const lookup = guarded(() => Promise.reject(new Error('token endpoint said SECRET')));

    await expect(lookup()).rejects.toEqual(new OutboundFailure('credential_lookup_failed'));
  });
});

describe('googleAccessTokens', () => {
  it('gives the token of the client', async () => {
    await expect(googleAccessTokens({ getAccessToken: () => Promise.resolve('ya29.token') })()).resolves.toBe(
      'ya29.token',
    );
  });

  it.each([null, undefined, ''])('fails when the client gives %j', async (token) => {
    await expect(googleAccessTokens({ getAccessToken: () => Promise.resolve(token) })()).rejects.toBeInstanceOf(
      OutboundFailure,
    );
  });
});

describe('the default credential chains', () => {
  it('are built without looking anything up', () => {
    expect(typeof awsCredentialChain(disabledProxy)).toBe('function');
    expect(typeof awsCredentialChain(enabledProxy)).toBe('function');
    expect(typeof googleCredentialChain('acme-ai')).toBe('function');
  });
});
