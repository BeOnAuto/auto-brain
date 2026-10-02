import { get } from 'node:http';
import { setTimeout } from 'node:timers/promises';

import { createApiKey } from '@beonauto/identity';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { startServer, tcpPort, defaultServerOptions, servedBy, type Served } from './lifecycle.ts';
import { isAcceptingConnections } from './testing/accepting-connections.ts';
import { testRoutes } from './testing/test-routes.ts';

const loopback = { HOST: '127.0.0.1', PORT: '0', LOCAL_MODE: 'true' };

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

function recordingWork(record: (event: string) => void): Served {
  return {
    routes: [
      (routes) => {
        routes.onClose(() => {
          record('routes closed');
          return Promise.resolve();
        });
      },
    ],
    stopWork: () => {
      record('work stopped');
      return Promise.resolve();
    },
  };
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

describe('the runtime of a server that cannot start', () => {
  it('is disposed before start-up rejects because the port is already taken', async () => {
    const first = await startServer(loopback, defaultServerOptions);
    const { runtimeLayer, events } = recordingDisposal();

    const failure = await startServer(
      { ...loopback, PORT: String(first.port) },
      {
        ...defaultServerOptions,
        runtimeLayer,
        serve: () =>
          recordingWork((event) => {
            events.push(event);
          }),
      },
    ).then(
      () => 'started',
      (error: unknown) => {
        events.push('start-up rejected');
        return String(error);
      },
    );
    await first.stop();

    expect(failure).toContain('EADDRINUSE');
    expect(events).toEqual(['work stopped', 'runtime disposed', 'routes closed', 'start-up rejected']);
  });

  it('is disposed before start-up rejects because its routes cannot be built', async () => {
    const { runtimeLayer, events } = recordingDisposal();

    const failure = await startServer(loopback, {
      ...defaultServerOptions,
      runtimeLayer,
      serve: () => Promise.reject(new Error('The routes cannot be built')),
    }).then(
      () => 'started',
      (error: unknown) => {
        events.push('start-up rejected');
        return String(error);
      },
    );

    expect(failure).toBe('Error: The routes cannot be built');
    expect(events).toEqual(['runtime disposed', 'start-up rejected']);
  });
});

describe('the runtime of a started server', () => {
  it('is kept until the server stops', async () => {
    const { runtimeLayer, events } = recordingDisposal();

    const server = await startServer(loopback, { ...defaultServerOptions, runtimeLayer });
    const whileRunning = [...events];
    await server.stop();

    expect({ whileRunning, afterStopping: events }).toEqual({ whileRunning: [], afterStopping: ['runtime disposed'] });
  });
});

describe('the work a started server does besides answering requests', () => {
  it('stops after the server stopped accepting connections, and before the runtime is disposed', async () => {
    const { runtimeLayer, events } = recordingDisposal();
    const listening = { port: 0 };
    const served = {
      routes: [],
      stopWork: async () => {
        const accepting = await isAcceptingConnections(listening.port);
        await setTimeout(50);
        events.push(`work stopped, accepting connections: ${String(accepting)}`);
      },
    };

    const server = await startServer(loopback, { ...defaultServerOptions, runtimeLayer, serve: () => served });
    listening.port = server.port;
    await server.stop();

    expect(events).toEqual(['work stopped, accepting connections: false', 'runtime disposed']);
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
    const server = await startServer(loopback, { ...defaultServerOptions, serve: () => servedBy([testRoutes]) });

    const response = await fetch(`http://127.0.0.1:${server.port}/slow?ms=1`);
    await server.stop();

    expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: { slept: 1 } });
  });

  it('answers an unexpected error with a 500 problem document', async () => {
    const server = await startServer(loopback, { ...defaultServerOptions, serve: () => servedBy([testRoutes]) });

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
    const server = await startServer(loopback, { ...defaultServerOptions, serve: () => servedBy([testRoutes]) });
    const inFlight = fetch(`http://127.0.0.1:${server.port}/slow?ms=300`);
    await setTimeout(50);
    const stopping = performance.now();

    await server.stop();
    const response = await inFlight;

    expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: { slept: 300 } });
    expect(performance.now() - stopping).toBeLessThan(2000);
  });
});

describe('the work a stopping server does besides answering requests', () => {
  it('stops while the requests in flight finish, not after them', async () => {
    const events: string[] = [];
    const server = await startServer(loopback, {
      ...defaultServerOptions,
      serve: () => ({
        routes: [testRoutes],
        stopWork: async () => {
          events.push('work stopping');
          await setTimeout(50);
          events.push('work stopped');
        },
      }),
    });
    const inFlight = fetch(`http://127.0.0.1:${server.port}/slow?ms=300`).then(() => {
      events.push('request answered');
      return events;
    });
    await setTimeout(50);

    await server.stop();
    await inFlight;

    expect(events.toSorted()).toEqual(['request answered', 'work stopped', 'work stopping']);
    expect(events.indexOf('work stopping')).toBeLessThan(events.indexOf('request answered'));
  });
});

describe('stopping a started server with connections still open', () => {
  it('closes a keep-alive connection that is idle, instead of waiting for it until the shutdown timeout', async () => {
    const server = await startServer(loopback, defaultServerOptions);
    await (await fetch(`http://127.0.0.1:${server.port}/health`)).text();
    const stopping = performance.now();

    await server.stop();

    expect(performance.now() - stopping).toBeLessThan(2000);
  });

  it('cuts off a request still running at the shutdown timeout', async () => {
    const server = await startServer(loopback, {
      ...defaultServerOptions,
      serve: () => servedBy([testRoutes]),
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

describe('tcpPort', () => {
  it('reads the port of a TCP address', () => {
    expect(tcpPort({ address: '127.0.0.1', family: 'IPv4', port: 4321 })).toBe(4321);
  });

  it.each([null, '/tmp/auto-brain.sock'])('rejects %s because it is not a TCP address', (address) => {
    expect(() => tcpPort(address)).toThrow(new TypeError('The server is not listening on a TCP port'));
  });
});
