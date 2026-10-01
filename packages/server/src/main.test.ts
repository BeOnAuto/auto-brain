import { fileURLToPath } from 'node:url';

import { createApiKey } from '@beonauto/identity';
import { describe, expect, it } from 'vitest';

import { spawnEntry } from './testing/spawned.ts';

const mainModule = fileURLToPath(new URL('main.ts', import.meta.url));

const loopback = { HOST: '127.0.0.1', PORT: '0' };

const invalidSettings: ReadonlyArray<readonly [Readonly<Record<string, string>>, string]> = [
  [{ PORT: 'eighty' }, 'InvalidPortError: PORT must be an integer from 0 to 65535, received "eighty"'],
  [{ ALLOWED_ORIGINS: 'app.example.com' }, 'InvalidSettingsError'],
  [{ API_KEYS: '[{"id":"ci-1"}]' }, 'InvalidApiKeysError: API_KEYS[0].org: Missing key'],
];

const protectedPath = '/v1/orgs/demo/brains';

describe('main', () => {
  it('serves health checks when launched with node and exits cleanly on SIGTERM', async () => {
    const child = spawnEntry(mainModule, loopback);
    const port = await child.port;

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect({ status: health.status, exitCode }).toEqual({ status: 200, exitCode: 0 });
  });

  it('writes exactly the listening line to stdout, and its logs as JSON lines to stderr', async () => {
    const child = spawnEntry(mainModule, loopback);
    const port = await child.port;

    await fetch(`http://127.0.0.1:${port}/health`);
    child.signal('SIGTERM');
    await child.exited;

    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
    expect(child.output().stderr).toMatch(/^\{"message":"Local mode is on: .*"level":"INFO".*\}\n$/u);
  });

  it.each<NodeJS.Signals>(['SIGTERM', 'SIGINT'])(
    'exits 0 on %s without waiting for the shutdown deadline',
    async (signal) => {
      const child = spawnEntry(mainModule, loopback);
      await child.port;

      const signalled = performance.now();
      child.signal(signal);
      const exitCode = await child.exited;

      expect(exitCode).toBe(0);
      expect(performance.now() - signalled).toBeLessThan(3000);
    },
  );
});

describe('main with settings', () => {
  it('requires an API key on protected paths once keys are configured, and says nothing about access', async () => {
    const { key, entry } = createApiKey({ id: 'ci-1', org: 'demo', permissions: ['org:read'], brains: '*' });
    const child = spawnEntry(mainModule, { ...loopback, API_KEYS: JSON.stringify([entry]) });
    const port = await child.port;

    const withoutKey = await fetch(`http://127.0.0.1:${port}${protectedPath}`);
    const withKey = await fetch(`http://127.0.0.1:${port}${protectedPath}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    child.signal('SIGTERM');
    await child.exited;

    expect({ withoutKey: withoutKey.status, withKey: withKey.status }).toEqual({ withoutKey: 401, withKey: 404 });
    expect(withoutKey.headers.get('www-authenticate')).toBe('Bearer');
    expect(child.output()).toEqual({ stdout: `auto-brain listening on port ${port}\n`, stderr: '' });
  });

  it.each(invalidSettings)(
    'refuses to start with %o, naming the error on stderr and writing nothing to stdout',
    async (env, error) => {
      const child = spawnEntry(mainModule, { ...loopback, ...env });

      expect(await child.exited).toBe(1);
      expect(child.output().stdout).toBe('');
      expect(child.output().stderr).toContain(error);
    },
  );
});
