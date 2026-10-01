import { describe, expect, it } from 'vitest';

import { authenticatorFor, createApiKey, type ApiKey } from './index.ts';

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['brain:read'], brains: ['alpha'] });

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: ['org:read', 'org:write'], brains: '*' });

const keys: readonly ApiKey[] = [reader.entry, admin.entry];

const wrongSecret = `abk_acme-reader_${'A'.repeat(43)}`;

describe('authenticatorFor without API keys', () => {
  it.each(['127.0.0.1', '127.1.2.3', '127.255.255.255', '::1', '0:0:0:0:0:0:0:1', 'localhost'])(
    'is in local mode on the loopback address %s',
    (host) => {
      expect(authenticatorFor({ host, apiKeys: undefined }).mode).toBe('local');
    },
  );

  it('admits every request in local mode as the local developer of whichever org it names', () => {
    const developer = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }).authenticate();

    expect(developer?.callerIn('globex')).toEqual({
      id: 'local',
      org: 'globex',
      permissions: ['org:read', 'org:write', 'brain:read', 'brain:write'],
      brains: '*',
    });
  });

  it.each(['0.0.0.0', '::', '10.0.0.1', '192.168.1.10', '128.0.0.1', 'auto-brain.example'])(
    'is closed on %s and admits nobody, whatever key is presented',
    (host) => {
      const authenticator = authenticatorFor({ host, apiKeys: undefined });

      expect(authenticator.mode).toBe('closed');
      expect([authenticator.authenticate(), authenticator.authenticate(reader.key)]).toEqual([undefined, undefined]);
    },
  );
});

describe('authenticatorFor with API keys', () => {
  it('enforces the keys even on loopback', () => {
    expect(authenticatorFor({ host: '127.0.0.1', apiKeys: keys }).mode).toBe('keys');
  });

  it('admits a configured key as a caller of its own org, whatever org a request names', () => {
    const holder = authenticatorFor({ host: '0.0.0.0', apiKeys: keys }).authenticate(reader.key);

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
  ])('refuses %s', (_case, presentedKey) => {
    expect(authenticatorFor({ host: '0.0.0.0', apiKeys: keys }).authenticate(presentedKey)).toBeUndefined();
  });

  it('refuses every key when the configured list is empty', () => {
    expect(authenticatorFor({ host: '127.0.0.1', apiKeys: [] }).authenticate(reader.key)).toBeUndefined();
  });
});
