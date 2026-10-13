import { describe, expect, it } from 'vitest';

import { authenticatorFor, createApiKey, type ApiKey, type Issuers } from '../index.ts';
import { principalIn } from '../testing/index.ts';

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: ['alpha'] });

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: ['org:read', 'org:write'], playbooks: '*' });

const keys: readonly ApiKey[] = [reader.entry, admin.entry];

const wrongSecret = `abk_acme-reader_${'A'.repeat(43)}`;

const loopbackHosts = ['127.0.0.1', '127.1.2.3', '127.255.255.255', '::1', '0:0:0:0:0:0:0:1', 'localhost'];

const otherHosts = [
  '0.0.0.0',
  '::',
  '10.0.0.1',
  '192.168.1.10',
  '128.0.0.1',
  'auto-runtime.example',
  'localhost.example.com',
  'localhost.evil',
];

const anyPath = '/v1/orgs/acme/playbooks';

const unexplained = { because: undefined };

const signedInAda = {
  org: 'acme',
  callerIn: (org: string) => ({ id: 'person:corp/ada', org, permissions: [], playbooks: [] }),
};

const tokensSeen: string[] = [];

const issuers: Issuers = {
  resource: { publicUrl: 'https://runtime.example', authorizationServers: ['https://login.example'] },
  personOf: (token, path) => {
    tokensSeen.push(`${token} at ${path}`);
    return Promise.resolve(token === 'a.token.of-ada' ? signedInAda : { because: 'ERR_JWS_INVALID' });
  },
};

describe('authenticatorFor with local mode on and no API keys', () => {
  it.each(loopbackHosts)('is in local mode on the loopback address %s', (host) => {
    expect(authenticatorFor({ host, apiKeys: undefined, localMode: true }).mode).toBe('local');
  });

  it('admits every request in local mode as the local developer of whichever org it names', async () => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined, localMode: true });
    const developer = principalIn(await authenticator.authenticate(undefined, anyPath));

    expect(developer?.callerIn('globex')).toEqual({
      id: 'local',
      org: 'globex',
      permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'],
      playbooks: '*',
    });
    expect(authenticator.resource).toBeUndefined();
  });

  it('gives the local developer the org local as its own', async () => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined, localMode: true });
    const developer = principalIn(await authenticator.authenticate('a.token.of-ada', anyPath));

    expect(developer?.org).toBe('local');
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
  it.each([...loopbackHosts, ...otherHosts])(
    'is closed on %s and admits nobody, whatever key is presented',
    async (host) => {
      const authenticator = authenticatorFor({ host, apiKeys: undefined, localMode: false });

      expect(authenticator.mode).toBe('closed');
      expect([
        await authenticator.authenticate(undefined, anyPath),
        await authenticator.authenticate(reader.key, anyPath),
      ]).toEqual([unexplained, unexplained]);
    },
  );
});

describe('authenticatorFor with API keys', () => {
  it('enforces the keys on loopback, even with local mode on', async () => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: keys, localMode: true });

    expect(authenticator.mode).toBe('credentials');
    expect(await authenticator.authenticate(undefined, anyPath)).toEqual(unexplained);
  });

  it('admits a configured key as a caller of its own org, and of no other', async () => {
    const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: keys, localMode: false });
    const holder = principalIn(await authenticator.authenticate(reader.key, anyPath));

    expect(holder?.callerIn('acme')).toEqual({
      id: 'acme-reader',
      org: 'acme',
      permissions: ['playbook:read'],
      playbooks: ['alpha'],
    });
    expect(holder?.callerIn('globex')).toBeUndefined();
    expect(holder?.org).toBe('acme');
  });

  it.each([
    ['no key', undefined],
    ['a wrong secret', wrongSecret],
    ['an unknown id', admin.key.replace('acme-admin', 'acme-other')],
    ['a malformed key', 'not-a-key'],
    ['the digest itself', reader.entry.sha256],
  ])('rejects %s', async (_case, presentedKey) => {
    expect(
      await authenticatorFor({ host: '0.0.0.0', apiKeys: keys, localMode: false }).authenticate(presentedKey, anyPath),
    ).toEqual(unexplained);
  });

  it.each([false, true])('is closed when the configured list is empty, with local mode %s', async (localMode) => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: [], localMode });

    expect(authenticator.mode).toBe('closed');
    expect([
      await authenticator.authenticate(undefined, anyPath),
      await authenticator.authenticate(reader.key, anyPath),
    ]).toEqual([unexplained, unexplained]);
  });
});

describe('authenticatorFor with identity providers', () => {
  it('checks credentials even with no key and local mode on, and names the protected resource', () => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: [], localMode: true, issuers });

    expect(authenticator.mode).toBe('credentials');
    expect(authenticator.resource).toEqual(issuers.resource);
  });

  it('asks the issuers about a token that is not a key, with the path the request reached', async () => {
    tokensSeen.length = 0;
    const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: keys, localMode: false, issuers });

    expect(await authenticator.authenticate('a.token.of-ada', '/mcp')).toBe(signedInAda);
    expect(await authenticator.authenticate('an.opaque.token', '/mcp')).toEqual({ because: 'ERR_JWS_INVALID' });
    expect(tokensSeen).toEqual(['a.token.of-ada at /mcp', 'an.opaque.token at /mcp']);
  });

  it('verifies a key as a key, never as a token', async () => {
    tokensSeen.length = 0;
    const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: keys, localMode: false, issuers });

    expect(principalIn(await authenticator.authenticate(admin.key, anyPath))?.org).toBe('acme');
    expect(await authenticator.authenticate(wrongSecret, anyPath)).toEqual(unexplained);
    expect(tokensSeen).toEqual([]);
  });
});
