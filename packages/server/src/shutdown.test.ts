import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { defaultServerOptions } from './lifecycle.ts';
import { shortShutdownTimeoutMs } from './testing/short-shutdown-timeout.ts';
import { spawnServer, spawnedServerTestTimeoutMs } from './testing/spawned-server.ts';

const serveWithTestRoutes = fileURLToPath(new URL('testing/serve-with-test-routes.ts', import.meta.url));

const loopback = { HOST: '127.0.0.1', PORT: '0' };

async function refusingConnections(port: number): Promise<void> {
  const accepted = await fetch(`http://127.0.0.1:${port}/health`).then(
    () => true,
    () => false,
  );
  if (accepted) {
    await setTimeout(10);
    await refusingConnections(port);
  }
}

describe('shutting down the server process', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('lets a slow request finish after SIGTERM and exits 0 before the shutdown timeout', async () => {
    const child = spawnServer(serveWithTestRoutes, loopback);
    const port = await child.port;
    const slow = fetch(`http://127.0.0.1:${port}/slow?ms=500`);
    await setTimeout(100);

    const signalled = performance.now();
    child.signal('SIGTERM');
    const response = await slow;
    const exitCode = await child.exited;

    expect({ status: response.status, body: await response.json(), exitCode }).toEqual({
      status: 200,
      body: { slept: 500 },
      exitCode: 0,
    });
    expect(performance.now() - signalled).toBeLessThan(shortShutdownTimeoutMs);
  });

  it('cuts off a request still running at the shutdown timeout and exits 0', async () => {
    const child = spawnServer(serveWithTestRoutes, loopback);
    const port = await child.port;
    const endless = fetch(`http://127.0.0.1:${port}/slow?ms=60000`).then(
      () => 'answered',
      () => 'cut off',
    );
    await setTimeout(100);

    const signalled = performance.now();
    child.signal('SIGTERM');
    const exitCode = await child.exited;
    const elapsed = performance.now() - signalled;

    expect({ exitCode, request: await endless }).toEqual({ exitCode: 0, request: 'cut off' });
    expect(elapsed).toBeGreaterThanOrEqual(shortShutdownTimeoutMs - 50);
    expect(elapsed).toBeLessThan(shortShutdownTimeoutMs + 1500);
  });
});

describe('a repeated stop signal', { timeout: spawnedServerTestTimeoutMs }, () => {
  it.each<NodeJS.Signals>(['SIGTERM', 'SIGINT'])(
    'is ignored while the server process shuts down after the first %s, which still exits 0',
    async (signal) => {
      const child = spawnServer(serveWithTestRoutes, loopback);
      const port = await child.port;
      const slow = fetch(`http://127.0.0.1:${port}/slow?ms=1000`);
      await setTimeout(100);

      child.signal(signal);
      await refusingConnections(port);
      child.signal(signal);
      const response = await slow;

      expect({ status: response.status, body: await response.json(), exitCode: await child.exited }).toEqual({
        status: 200,
        body: { slept: 1000 },
        exitCode: 0,
      });
    },
  );
});

describe(
  'a server process that something keeps running after it stopped',
  { timeout: spawnedServerTestTimeoutMs },
  () => {
    it('exits 0 at the exit deadline and says why on stderr', async () => {
      const child = spawnServer(serveWithTestRoutes, loopback);
      const port = await child.port;
      await (await fetch(`http://127.0.0.1:${port}/linger?ms=60000`)).text();

      child.signal('SIGTERM');

      expect(await child.exited).toBe(0);
      expect(child.output().stderr).toContain(
        `auto-brain was still running ${defaultServerOptions.exitDeadlineMs} ms after it stopped, so it exits now\n`,
      );
    });
  },
);
