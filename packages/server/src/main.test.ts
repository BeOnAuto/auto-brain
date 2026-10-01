import { fileURLToPath } from 'node:url';

import { createApiKey } from '@beonauto/identity';
import { afterAll, describe, expect, it } from 'vitest';

import { spawnServer } from './testing/spawned-server.ts';
import { temporaryLedger } from './testing/temporary-ledger.ts';

const mainModule = fileURLToPath(new URL('main.ts', import.meta.url));

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const loopback = { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName };

const invalidSettings: ReadonlyArray<readonly [Readonly<Record<string, string>>, string]> = [
  [{ PORT: 'eighty' }, 'InvalidPortError: PORT must be an integer from 0 to 65535, received "eighty"'],
  [{ ALLOWED_ORIGINS: 'app.example.com' }, 'InvalidSettingsError: SchemaError(Expected an origin'],
  [{ API_KEYS: '[{"id":"ci-1"}]' }, 'InvalidApiKeysError: API_KEYS[0].org: Missing key'],
];

const protectedPath = '/v1/orgs/demo/brains';

describe('main', () => {
  it('serves health checks when launched with node and exits cleanly on SIGTERM', async () => {
    const child = spawnServer(mainModule, loopback);
    const port = await child.port;

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect({ status: health.status, exitCode }).toEqual({ status: 200, exitCode: 0 });
  });

  it('writes exactly the listening line to stdout, and its logs as JSON lines to stderr', async () => {
    const child = spawnServer(mainModule, loopback);
    const port = await child.port;

    await fetch(`http://127.0.0.1:${port}/health`);
    child.signal('SIGTERM');
    await child.exited;

    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
    expect(child.output().stderr).toMatch(/^\{"message":"Local mode is on: .*"level":"INFO".*\}\n$/u);
  });

  it.each<NodeJS.Signals>(['SIGTERM', 'SIGINT'])(
    'exits 0 on %s without waiting for the shutdown timeout',
    async (signal) => {
      const child = spawnServer(mainModule, loopback);
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
    const child = spawnServer(mainModule, { ...loopback, API_KEYS: JSON.stringify([entry]) });
    const port = await child.port;

    const withoutKey = await fetch(`http://127.0.0.1:${port}${protectedPath}`);
    const withKey = await fetch(`http://127.0.0.1:${port}${protectedPath}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    child.signal('SIGTERM');
    await child.exited;

    expect({ withoutKey: withoutKey.status, withKey: withKey.status }).toEqual({ withoutKey: 401, withKey: 200 });
    expect(withoutKey.headers.get('www-authenticate')).toBe('Bearer');
    expect(child.output()).toEqual({ stdout: `auto-brain listening on port ${port}\n`, stderr: '' });
  });

  it.each(invalidSettings)(
    'does not start with %o, naming the error in one line on stderr and writing nothing to stdout',
    async (env, error) => {
      const child = spawnServer(mainModule, { ...loopback, ...env });

      expect(await child.exited).toBe(1);
      expect(child.output().stdout).toBe('');
      expect(child.output().stderr.split('\n')).toEqual([
        expect.stringContaining(`auto-brain could not start: ${error}`),
        '',
      ]);
    },
  );

  it('does not echo API_KEYS when it cannot read them', async () => {
    const { key } = createApiKey({ id: 'ci-1', org: 'demo', permissions: ['org:read'], brains: '*' });
    const child = spawnServer(mainModule, { ...loopback, API_KEYS: key });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr: 'auto-brain could not start: InvalidApiKeysError: API_KEYS: Expected a valid JSON string\n',
    });
  });
});
