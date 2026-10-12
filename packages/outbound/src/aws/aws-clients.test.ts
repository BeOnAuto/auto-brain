import { describe, expect, it } from 'vitest';

import { awsClientSettingsOf, awsCredentialChain } from './aws-clients.ts';

const disabledProxy = { enabled: false, environment: { HTTPS_PROXY: 'http://proxy.internal:3128' } };

const enabledProxy = {
  enabled: true,
  environment: { HTTPS_PROXY: 'http://proxy.internal:3128', NO_PROXY: '169.254.169.254' },
};

describe('the settings of an AWS client', () => {
  it('leave the request handler to the client without the environment proxy', () => {
    expect(awsClientSettingsOf(disabledProxy)).toEqual({});
  });

  it('send its requests through the environment proxy when it is enabled, by HTTP and HTTPS alike', () => {
    const proxyEnv = { HTTPS_PROXY: 'http://proxy.internal:3128', NO_PROXY: '169.254.169.254' };

    expect(awsClientSettingsOf(enabledProxy)).toEqual({
      requestHandler: { httpAgent: { proxyEnv }, httpsAgent: { proxyEnv } },
    });
  });
});

describe('the default credential chain of AWS', () => {
  it('is built without looking anything up, with the environment proxy or without it', () => {
    expect(typeof awsCredentialChain(disabledProxy)).toBe('function');
    expect(typeof awsCredentialChain(enabledProxy)).toBe('function');
  });
});
