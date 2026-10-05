import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { spawnServer, spawnedServerTestTimeoutMs } from '../testing/spawned-server.ts';
import { startServer } from './lifecycle.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const password = 'a-secret-password';

async function aPortNobodyListensOn(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  await once(server, 'close');
  return typeof address === 'object' && address !== null ? address.port : 0;
}

async function unreachableDatabase(): Promise<{ readonly url: string; readonly port: number }> {
  const port = await aPortNobodyListensOn();
  return { url: `postgresql://brains:${password}@127.0.0.1:${port}/brains`, port };
}

describe('a ledger in PostgreSQL that cannot be reached', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('stops start-up with a named error that gives the address and no credential', async () => {
    const { url, port } = await unreachableDatabase();

    const failure = await startServer({ HOST: '127.0.0.1', PORT: '0', DATABASE_URL: url }, compositionRoot).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ name: 'StartupError' });
    expect(String(failure)).toContain(`ECONNREFUSED 127.0.0.1:${port}`);
    expect(String(failure)).not.toContain(password);
  });

  it('stops the process with the error on one line of stderr, without the URL', async () => {
    const { url, port } = await unreachableDatabase();

    const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', DATABASE_URL: url });

    expect(await child.exited).toBe(1);
    expect(child.output().stdout).toBe('');
    expect(child.output().stderr.split('\n')).toEqual([
      expect.stringMatching(
        new RegExp(
          `^auto-brain could not start: StartupError: The server's services could not start: .*ECONNREFUSED 127\\.0\\.0\\.1:${port}`,
          'u',
        ),
      ),
      '',
    ]);
    expect(child.output().stderr).not.toContain(password);
  });
});

describe('a server given both DATABASE_URL and LEDGER_FILE', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('does not start, naming both settings and neither value', async () => {
    const child = spawnServer(mainModule, {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: '/data/ledger.db',
      DATABASE_URL: `postgresql://brains:${password}@db.example.com/brains`,
    });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr:
        'auto-brain could not start: InvalidSettingsError: The ledger settings are invalid. DATABASE_URL: Set DATABASE_URL or LEDGER_FILE, not both\n',
    });
  });
});
