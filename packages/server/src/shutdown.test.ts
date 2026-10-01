import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { shortShutdownDeadlineMs } from './testing/short-shutdown-deadline.ts';
import { spawnEntry } from './testing/spawned.ts';

const serveWithTestRoutes = fileURLToPath(new URL('testing/serve-with-test-routes.ts', import.meta.url));

const loopback = { HOST: '127.0.0.1', PORT: '0' };

describe('shutting down the server process', () => {
  it('lets a slow request finish after SIGTERM and exits 0 before the deadline', async () => {
    const child = spawnEntry(serveWithTestRoutes, loopback);
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
    expect(performance.now() - signalled).toBeLessThan(shortShutdownDeadlineMs);
  });

  it('cuts off a request still running at the deadline and exits 0', async () => {
    const child = spawnEntry(serveWithTestRoutes, loopback);
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
    expect(elapsed).toBeGreaterThanOrEqual(shortShutdownDeadlineMs - 50);
    expect(elapsed).toBeLessThan(shortShutdownDeadlineMs + 1500);
  });
});
