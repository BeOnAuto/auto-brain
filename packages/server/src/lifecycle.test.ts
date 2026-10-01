import { get } from 'node:http';
import { setTimeout } from 'node:timers/promises';

import type { Environment } from '@beonauto/config';
import { createApiKey } from '@beonauto/identity';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { runServer, startServer, tcpPort, defaultServerOptions, type ServerProcess } from './lifecycle.ts';
import { testRoutes } from './testing/test-routes.ts';

const loopback = { HOST: '127.0.0.1', PORT: '0', LOCAL_MODE: 'true' };

function fakeProcess(env: Environment = loopback): {
  serverProcess: ServerProcess;
  signals: EventTarget;
  written: string[];
} {
  const signals = new EventTarget();
  const written: string[] = [];
  const serverProcess: ServerProcess = {
    env,
    stdout: { write: (message) => written.push(message) },
    once: (signal, listener) => {
      signals.addEventListener(signal, listener, { once: true });
    },
  };
  return { serverProcess, signals, written };
}

async function isAcceptingConnections(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`);
    return true;
  } catch {
    return false;
  }
}

function recordingDisposal(): { runtimeLayer: () => Layer.Layer<never>; events: string[] } {
  const events: string[] = [];
  const recording = Layer.effectDiscard(
    Effect.addFinalizer(() =>
      Effect.sync(() => {
        events.push('runtime disposed');
      }),
    ),
  );
  return { runtimeLayer: () => recording, events };
}

function statusOf(port: number, path: string, headers: Readonly<Record<string, string>>): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, headers }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
}

describe('startServer', () => {
  it('listens on the port the operating system assigns for port 0', async () => {
    const server = await startServer({ HOST: '127.0.0.1', PORT: '0' }, defaultServerOptions);

    expect(await isAcceptingConnections(server.port)).toBe(true);
    await server.stop();
  });

  it('stops accepting connections once stopped, and stopping again is harmless', async () => {
    const server = await startServer({ HOST: '127.0.0.1', PORT: '0' }, defaultServerOptions);
    await server.stop();
    await server.stop();

    expect(await isAcceptingConnections(server.port)).toBe(false);
  });

  it('rejects when the port is already taken', async () => {
    const first = await startServer({ HOST: '127.0.0.1', PORT: '0' }, defaultServerOptions);

    await expect(startServer({ HOST: '127.0.0.1', PORT: String(first.port) }, defaultServerOptions)).rejects.toThrow(
      'EADDRINUSE',
    );
    await first.stop();
  });
});

describe('the runtime of a started server', () => {
  it('is disposed before start-up rejects because the port is already taken', async () => {
    const first = await startServer(loopback, defaultServerOptions);
    const { runtimeLayer, events } = recordingDisposal();

    const failure = await startServer(
      { ...loopback, PORT: String(first.port) },
      { ...defaultServerOptions, runtimeLayer },
    ).then(
      () => 'started',
      (error: unknown) => {
        events.push('start-up rejected');
        return String(error);
      },
    );
    await first.stop();

    expect(failure).toContain('EADDRINUSE');
    expect(events).toEqual(['runtime disposed', 'start-up rejected']);
  });

  it('is kept until the server stops', async () => {
    const { runtimeLayer, events } = recordingDisposal();

    const server = await startServer(loopback, { ...defaultServerOptions, runtimeLayer });
    const whileRunning = [...events];
    await server.stop();

    expect({ whileRunning, afterStopping: events }).toEqual({ whileRunning: [], afterStopping: ['runtime disposed'] });
  });
});

describe('startServer validates requests from browsers', () => {
  it('is in local mode on loopback without API keys, so it rejects a Host header that is not localhost', async () => {
    const server = await startServer(loopback, defaultServerOptions);

    const foreign = await statusOf(server.port, '/nowhere', { host: 'evil.example' });
    const local = await statusOf(server.port, '/nowhere', { host: `localhost:${server.port}` });
    await server.stop();

    expect({ foreign, local }).toEqual({ foreign: 403, local: 404 });
  });

  it('is not in local mode once API keys are configured, so it checks the key and not the Host header', async () => {
    const { key, entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], brains: '*' });
    const server = await startServer({ ...loopback, API_KEYS: JSON.stringify([entry]) }, defaultServerOptions);

    const withoutKey = await statusOf(server.port, '/v1/orgs/acme/brains', { host: 'evil.example' });
    const withKey = await statusOf(server.port, '/v1/orgs/acme/brains', {
      host: 'evil.example',
      authorization: `Bearer ${key}`,
    });
    await server.stop();

    expect({ withoutKey, withKey }).toEqual({ withoutKey: 401, withKey: 404 });
  });

  it('rejects a request from an origin ALLOWED_ORIGINS does not list', async () => {
    const server = await startServer({ ...loopback, ALLOWED_ORIGINS: 'https://app.example.com' }, defaultServerOptions);

    const allowed = await statusOf(server.port, '/nowhere', { origin: 'https://app.example.com' });
    const foreign = await statusOf(server.port, '/nowhere', { origin: 'https://evil.example' });
    await server.stop();

    expect({ allowed, foreign }).toEqual({ allowed: 404, foreign: 403 });
  });
});

describe('startServer with routes', () => {
  it('serves the routes it is given', async () => {
    const server = await startServer(loopback, { ...defaultServerOptions, routes: () => [testRoutes] });

    const response = await fetch(`http://127.0.0.1:${server.port}/slow?ms=1`);
    await server.stop();

    expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: { slept: 1 } });
  });

  it('answers an unexpected error with a 500 problem document', async () => {
    const server = await startServer(loopback, { ...defaultServerOptions, routes: () => [testRoutes] });

    const response = await fetch(`http://127.0.0.1:${server.port}/fail`);
    await server.stop();

    expect({ status: response.status, body: await response.json() }).toMatchObject({
      status: 500,
      body: { reason: 'internal' },
    });
  });
});

describe('stopping a started server', () => {
  it('lets a request in flight finish, then stops without waiting for the shutdown timeout', async () => {
    const server = await startServer(loopback, { ...defaultServerOptions, routes: () => [testRoutes] });
    const inFlight = fetch(`http://127.0.0.1:${server.port}/slow?ms=300`);
    await setTimeout(50);
    const stopping = performance.now();

    await server.stop();
    const response = await inFlight;

    expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: { slept: 300 } });
    expect(performance.now() - stopping).toBeLessThan(2000);
  });

  it('cuts off a request still running at the shutdown timeout', async () => {
    const server = await startServer(loopback, {
      ...defaultServerOptions,
      routes: () => [testRoutes],
      shutdownTimeoutMs: 100,
    });
    const inFlight = fetch(`http://127.0.0.1:${server.port}/slow?ms=60000`).then(
      () => 'answered',
      () => 'cut off',
    );
    await setTimeout(50);
    const stopping = performance.now();

    await server.stop();

    expect(performance.now() - stopping).toBeLessThan(1000);
    expect(await inFlight).toBe('cut off');
  });
});

describe('runServer', () => {
  it('announces the port it listens on', async () => {
    const { serverProcess, written } = fakeProcess();
    const server = await runServer(serverProcess, defaultServerOptions);

    expect(written).toEqual([`auto-brain listening on port ${server.port}\n`]);
    await server.stop();
  });

  it.each(['SIGTERM', 'SIGINT'])('shuts down gracefully on %s', async (signal) => {
    const { serverProcess, signals } = fakeProcess();
    const server = await runServer(serverProcess, defaultServerOptions);

    signals.dispatchEvent(new Event(signal));
    await server.stop();

    expect(await isAcceptingConnections(server.port)).toBe(false);
  });

  it('rejects invalid settings before it listens, with a named error, and announces nothing', async () => {
    const { serverProcess, written } = fakeProcess({ ...loopback, ALLOWED_ORIGINS: 'app.example.com' });

    await expect(runServer(serverProcess, defaultServerOptions)).rejects.toMatchObject({
      name: 'InvalidSettingsError',
    });
    expect(written).toEqual([]);
  });

  it('rejects invalid API keys before it listens, with a named error, and announces nothing', async () => {
    const { serverProcess, written } = fakeProcess({ ...loopback, API_KEYS: '[{"id":"ci-1"}]' });

    await expect(runServer(serverProcess, defaultServerOptions)).rejects.toMatchObject({ name: 'InvalidApiKeysError' });
    expect(written).toEqual([]);
  });
});

describe('tcpPort', () => {
  it('reads the port of a TCP address', () => {
    expect(tcpPort({ address: '127.0.0.1', family: 'IPv4', port: 4321 })).toBe(4321);
  });

  it.each([null, '/tmp/auto-brain.sock'])('rejects %s because it is not a TCP address', (address) => {
    expect(() => tcpPort(address)).toThrow(new TypeError('The server is not listening on a TCP port'));
  });
});
