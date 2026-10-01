import { describe, expect, it } from 'vitest';

import { authenticatorFor, createApiKey, type ApiKey } from './index.ts';

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['brain:read'], brains: ['alpha'] });

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: ['org:read', 'org:write'], brains: '*' });

const keys: readonly ApiKey[] = [reader.entry, admin.entry];

const wrongSecret = `abk_acme-reader_${'A'.repeat(43)}`;

const loopbackHosts = ['127.0.0.1', '127.1.2.3', '127.255.255.255', '::1', '0:0:0:0:0:0:0:1', 'localhost'];

const otherHosts = [
  '0.0.0.0',
  '::',
  '10.0.0.1',
  '192.168.1.10',
  '128.0.0.1',
  'auto-brain.example',
  'localhost.example.com',
  'localhost.evil',
];

describe('authenticatorFor with local mode on and no API keys', () => {
  it.each(loopbackHosts)('is in local mode on the loopback address %s', (host) => {
    expect(authenticatorFor({ host, apiKeys: undefined, localMode: true }).mode).toBe('local');
  });

  it('admits every request in local mode as the local developer of whichever org it names', () => {
    const developer = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined, localMode: true }).authenticate();

    expect(developer?.callerIn('globex')).toEqual({
      id: 'local',
      org: 'globex',
      permissions: ['org:read', 'org:write', 'brain:read', 'brain:write'],
      brains: '*',
    });
  });

  it.each(otherHosts)('stops start-up on %s, which is not loopback, with a named error', (host) => {
    expect(() => authenticatorFor({ host, apiKeys: undefined, localMode: true })).toThrow(
      expect.objectContaining({
        name: 'InvalidLocalModeError',
        message: `LOCAL_MODE is on, but HOST ${host} is not a loopback address; local mode trusts every request, so it runs only on localhost, 127.0.0.1 or ::1`,
      }),
    );
  });

  it('stops start-up off loopback even when API keys are configured', () => {
    expect(() => authenticatorFor({ host: '0.0.0.0', apiKeys: keys, localMode: true })).toThrow(
      expect.objectContaining({ name: 'InvalidLocalModeError' }),
    );
  });
});

describe('authenticatorFor with local mode off and no API keys', () => {
  it.each([...loopbackHosts, ...otherHosts])('is closed on %s and admits nobody, whatever key is presented', (host) => {
    const authenticator = authenticatorFor({ host, apiKeys: undefined, localMode: false });

    expect(authenticator.mode).toBe('closed');
    expect([authenticator.authenticate(), authenticator.authenticate(reader.key)]).toEqual([undefined, undefined]);
  });
});

describe('authenticatorFor with API keys', () => {
  it('enforces the keys on loopback, even with local mode on', () => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: keys, localMode: true });

    expect(authenticator.mode).toBe('keys');
    expect(authenticator.authenticate()).toBeUndefined();
  });

  it('admits a configured key as a caller of its own org, whatever org a request names', () => {
    const holder = authenticatorFor({ host: '0.0.0.0', apiKeys: keys, localMode: false }).authenticate(reader.key);

    expect(holder?.callerIn('globex')).toEqual({
      id: 'acme-reader',
      org: 'acme',
      permissions: ['brain:read'],
      brains: ['alpha'],
    });
  });

  it.each([
    ['no key', undefined],
    ['a wrong secret', wrongSecret],
    ['an unknown id', admin.key.replace('acme-admin', 'acme-other')],
    ['a malformed key', 'not-a-key'],
    ['the digest itself', reader.entry.sha256],
  ])('rejects %s', (_case, presentedKey) => {
    expect(
      authenticatorFor({ host: '0.0.0.0', apiKeys: keys, localMode: false }).authenticate(presentedKey),
    ).toBeUndefined();
  });

  it.each([false, true])('is closed when the configured list is empty, with local mode %s', (localMode) => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: [], localMode });

    expect(authenticator.mode).toBe('closed');
    expect([authenticator.authenticate(), authenticator.authenticate(reader.key)]).toEqual([undefined, undefined]);
  });
});
