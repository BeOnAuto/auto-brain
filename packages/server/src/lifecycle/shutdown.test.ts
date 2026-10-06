import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { shortShutdownTimeoutMs } from '../testing/short-shutdown-timeout.ts';
import { spawnServer, spawnedServerTestTimeoutMs } from '../testing/spawned-server.ts';
import { defaultServerOptions } from './lifecycle.ts';

const serveWithTestRoutes = fileURLToPath(new URL('../testing/serve-with-test-routes.ts', import.meta.url));

const loopback = { HOST: '127.0.0.1', PORT: '0', LOCAL_MODE: 'true' };

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

function answeringSlowly(port: number, ms: number): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/slow-body?ms=${ms}`);
}

describe('shutting down the server process', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('lets a slow request finish after SIGTERM and exits 0 before the shutdown timeout', async () => {
    const child = spawnServer(serveWithTestRoutes, loopback);
    const slow = await answeringSlowly(await child.port, 500);

    const signalled = performance.now();
    child.signal('SIGTERM');
    const body: unknown = await slow.json();
    const exitCode = await child.exited;

    expect({ status: slow.status, body, exitCode }).toEqual({ status: 200, body: { slept: 500 }, exitCode: 0 });
    expect(performance.now() - signalled).toBeLessThan(shortShutdownTimeoutMs);
  });

  it('cuts off a request still running at the shutdown timeout and exits 0', async () => {
    const child = spawnServer(serveWithTestRoutes, loopback);
    const endless = await answeringSlowly(await child.port, 60_000);
    const answer = endless.json().then(
      () => 'answered',
      () => 'cut off',
    );

    const signalled = performance.now();
    child.signal('SIGTERM');
    const exitCode = await child.exited;
    const elapsed = performance.now() - signalled;

    expect({ exitCode, request: await answer }).toEqual({ exitCode: 0, request: 'cut off' });
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
      const slow = await answeringSlowly(port, 1000);

      child.signal(signal);
      await refusingConnections(port);
      child.signal(signal);

      expect({ status: slow.status, body: await slow.json(), exitCode: await child.exited }).toEqual({
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
