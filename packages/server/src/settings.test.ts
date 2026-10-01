import { InvalidPortError, type Environment } from '@beonauto/config';
import { createApiKey } from '@beonauto/identity';
import { describe, expect, it } from 'vitest';

import { readSettings } from './settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettings(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], brains: '*' });

describe('readSettings', () => {
  it('listens on every interface at port 8080, allows no origin and has no API keys when nothing is configured', () => {
    expect(readSettings({})).toEqual({ host: '0.0.0.0', port: 8080, allowedOrigins: [], apiKeys: undefined });
  });

  it('reads every setting from the environment it is given', () => {
    expect(
      readSettings({
        HOST: '127.0.0.1',
        PORT: '3000',
        ALLOWED_ORIGINS: 'https://app.example.com,http://localhost:5173,http://[::1]:3000',
        API_KEYS: JSON.stringify([entry]),
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 3000,
      allowedOrigins: ['https://app.example.com', 'http://localhost:5173', 'http://[::1]:3000'],
      apiKeys: [entry],
    });
  });

  it('treats empty variables as not set', () => {
    expect(readSettings({ ALLOWED_ORIGINS: '', API_KEYS: '' })).toMatchObject({
      allowedOrigins: [],
      apiKeys: undefined,
    });
  });

  it.each([' ', '\t', '  \n  '])('treats API_KEYS=%j, only whitespace, as no API keys', (keys) => {
    expect(readSettings({ API_KEYS: keys })).toMatchObject({ apiKeys: undefined });
  });
});

describe('readSettings refuses invalid settings', () => {
  it.each([
    'https://app.example.com/',
    'app.example.com',
    'https://App.example.com',
    'https://app.example.com:443',
    ' https://app.example.com',
    'null',
    '*',
    'https://a.example,,https://b.example',
  ])('refuses ALLOWED_ORIGINS="%s" with a named error', (origins) => {
    const error = errorFrom({ ALLOWED_ORIGINS: origins });

    expect(error).toMatchObject({ name: 'InvalidSettingsError', _tag: 'InvalidSettingsError' });
    expect(String(error)).toContain('ALLOWED_ORIGINS');
    expect(String(error)).toContain('Expected an origin such as https://app.example.com');
  });

  it('refuses invalid API keys with the named error from the identity settings', () => {
    expect(String(errorFrom({ API_KEYS: '[{"id":"ci-1"}]' }))).toContain('InvalidApiKeysError: API_KEYS[0].org');
  });

  it('refuses an invalid port with the named error from the server configuration', () => {
    expect(errorFrom({ PORT: 'eighty' })).toEqual(new InvalidPortError('eighty'));
  });
});
