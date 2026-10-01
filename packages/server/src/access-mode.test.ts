import { fileURLToPath } from 'node:url';

import { createApiKey } from '@beonauto/identity';
import { allPermissions } from '@beonauto/operations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from './composition-root.ts';
import { startServer } from './lifecycle.ts';
import { spawnServer } from './testing/spawned-server.ts';
import { temporaryLedger, type TemporaryLedger } from './testing/temporary-ledger.ts';

const mainModule = fileURLToPath(new URL('main.ts', import.meta.url));

const { key, entry } = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' });

let ledger: TemporaryLedger;

beforeEach(() => {
  ledger = temporaryLedger();
});

afterEach(() => {
  ledger.remove();
});

async function servedBy(
  env: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {},
): Promise<{ readonly status: number; readonly stderr: string }> {
  const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName, ...env });
  const response = await fetch(`http://127.0.0.1:${await child.port}/v1/orgs/acme/brains`, { headers });
  child.signal('SIGTERM');
  await child.exited;
  return { status: response.status, stderr: child.output().stderr };
}

describe('the access mode of a server on loopback', () => {
  it('trusts a request without a key only when LOCAL_MODE is on, and warns that it does', async () => {
    const served = await servedBy({ LOCAL_MODE: 'true' });

    expect(served.status).toBe(200);
    expect(served.stderr).toContain('"message":"Local mode is on: every request is trusted as the local developer');
    expect(served.stderr).toContain('"level":"WARN"');
  });

  it('is closed without LOCAL_MODE, even for a request whose Host a proxy rewrote to localhost', async () => {
    const served = await servedBy({}, { host: 'localhost' });

    expect(served.status).toBe(401);
    expect(served.stderr).toContain(
      '"message":"No request can authenticate: API_KEYS lists no keys and local mode is off, so every path except /health answers 401"',
    );
  });

  it('warns that no request can authenticate when API_KEYS lists no keys', async () => {
    const served = await servedBy({ API_KEYS: '[]' });

    expect(served.status).toBe(401);
    expect(served.stderr).toContain('"message":"No request can authenticate:');
  });

  it('enforces API keys when LOCAL_MODE is also on, and warns that local mode is ignored', async () => {
    const withoutKey = await servedBy({ LOCAL_MODE: 'true', API_KEYS: JSON.stringify([entry]) });
    const withKey = await servedBy(
      { LOCAL_MODE: 'true', API_KEYS: JSON.stringify([entry]) },
      { authorization: `Bearer ${key}` },
    );

    expect([withoutKey.status, withKey.status]).toEqual([401, 200]);
    expect(withoutKey.stderr).toContain('"message":"LOCAL_MODE is ignored because API keys are configured"');
    expect(withoutKey.stderr).not.toContain('Local mode is on');
  });
});

describe('LOCAL_MODE off loopback', () => {
  it('stops start-up with a named error before the server listens', async () => {
    await expect(
      startServer({ HOST: '0.0.0.0', PORT: '0', LEDGER_FILE: ledger.fileName, LOCAL_MODE: 'true' }, compositionRoot),
    ).rejects.toMatchObject({ name: 'InvalidLocalModeError' });
  });
});
