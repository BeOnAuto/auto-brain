import { setTimeout } from 'node:timers/promises';

import { Effect, Fiber } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  fakeStdioServerPath,
  fakeToolNames,
  reportingAccess,
  serveFakeMcp,
  stdioTestTimeoutMs,
  verboseDescription,
  type AccessOptions,
  type FakeMcpServer,
} from '../testing/index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const alpha = { org: 'acme', brain: 'alpha' };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
}, stdioTestTimeoutMs);

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function remote(fake: FakeMcpServer, changes: Readonly<Record<string, unknown>> = {}) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...changes };
}

function accessTo(servers: Readonly<Record<string, unknown>>, options: AccessOptions = {}) {
  const { access } = reportingAccess(servers, {
    ...options,
    environment: { GRAPH_API_KEY: apiKey, NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'], ...options.environment },
  });
  closing.push(access.close);
  return access;
}

function listed(servers: Readonly<Record<string, unknown>>, options: AccessOptions = {}, named?: string) {
  return Effect.runPromise(accessTo(servers, options).listServers(alpha, named));
}

const searchTool = {
  name: 'search',
  description: 'Finds the rows of the graph that match a query.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What to look for' } },
    required: ['query'],
  },
};

const nothingTaken = { type: 'object', properties: {}, required: [] };

const echoTool = { name: 'echo', description: 'Answers with its arguments.', input_schema: nothingTaken };

describe('the tool servers a brain may use', () => {
  it('are those that serve its org and brain, by name, each with the tools the operator allows', async () => {
    const fake = await fakeServer();
    const servers = {
      wiki: remote(fake),
      notes: remote(fake),
      graph: remote(fake),
      crm: remote(fake, { org: 'globex' }),
      sales: remote(fake, { brains: ['sales'] }),
      support: remote(fake, { brains: ['alpha', 'support'] }),
    };

    const listing = await listed(servers, { allowed: ['graph/search', 'graph/echo', 'notes/*', 'support/profile'] });

    expect(listing).toMatchObject([
      { name: 'graph', type: 'http', tools: [searchTool, echoTool] },
      { name: 'notes', type: 'http', tools: fakeToolNames.map((name) => ({ name })) },
      { name: 'support', type: 'http', tools: [{ name: 'profile', description: '', input_schema: nothingTaken }] },
      { name: 'wiki', type: 'http', tools: [] },
    ]);
  });

  it('have the descriptions of their tools cut as a run cuts them', async () => {
    const fake = await fakeServer();

    const listing = await listed({ graph: remote(fake) }, { allowed: ['graph/verbose'] });

    expect(verboseDescription.length).toBeGreaterThan(4096);
    expect(listing).toEqual([
      {
        name: 'graph',
        type: 'http',
        tools: [{ name: 'verbose', description: verboseDescription.slice(0, 4096), input_schema: nothingTaken }],
      },
    ]);
  });
});

describe('the tool servers a listing asks', () => {
  it('are only the server asked for, when one is, and no other is asked', async () => {
    const fake = await fakeServer();
    const other = await fakeServer();
    const servers = { graph: remote(fake), wiki: remote(other) };

    const listing = await listed(servers, { allowed: ['graph/echo'] }, 'graph');
    const unknown = await listed(servers, {}, 'mail');

    expect(listing).toEqual([{ name: 'graph', type: 'http', tools: [echoTool] }]);
    expect(unknown).toEqual([]);
    expect(other.seen()).toEqual([]);
  });

  it('are none, and no server is asked, when none serves the brain', async () => {
    const fake = await fakeServer();

    const listing = await listed({ crm: remote(fake, { org: 'globex' }), sales: remote(fake, { brains: ['sales'] }) });

    expect(listing).toEqual([]);
    expect(fake.seen()).toEqual([]);
  });
});

describe('a tool server on which the operator allows no tool', () => {
  it('is listed with no tools and is never asked, as no run could reach it', async () => {
    const fake = await fakeServer();
    const quiet = await fakeServer();

    const listing = await listed({ graph: remote(fake), quiet: remote(quiet) }, { allowed: ['graph/echo'] });

    expect(listing).toEqual([
      { name: 'graph', type: 'http', tools: [echoTool] },
      { name: 'quiet', type: 'http', tools: [] },
    ]);
    expect(quiet.seen()).toEqual([]);
  });
});

describe('a tool server that is a process', () => {
  it('lists the tools of the process the server starts', { timeout: stdioTestTimeoutMs }, async () => {
    const limitless = {
      command: process.execPath,
      args: [fakeStdioServerPath],
      env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
      org: 'acme',
    };

    const listing = await listed({ limitless }, { allowed: ['limitless/search'] });

    expect(listing).toEqual([{ name: 'limitless', type: 'stdio', tools: [searchTool] }]);
  });
});

async function initializing(fake: FakeMcpServer): Promise<void> {
  if (fake.seen().some(({ rpc }) => rpc === 'initialize')) {
    return;
  }
  await setTimeout(1);
  await initializing(fake);
}

async function sessionsEnded(fake: FakeMcpServer, waited = 0): Promise<number> {
  if (fake.endedSessions() > 0 || waited >= 5000) {
    return fake.endedSessions();
  }
  await setTimeout(10);
  return sessionsEnded(fake, waited + 10);
}

describe('the session a listing opens', () => {
  it('is ended once the listing has its tools, five requests in all', async () => {
    const fake = await fakeServer();

    await listed({ graph: remote(fake) });

    expect(fake.seen().map(({ method, rpc = '' }) => `${method} ${rpc}`.trim())).toEqual(
      expect.arrayContaining(['POST initialize', 'POST notifications/initialized', 'GET', 'POST tools/list', 'DELETE']),
    );
    expect(fake.seen()).toHaveLength(5);
    expect(fake.openSessions()).toBe(0);
    expect(fake.endedSessions()).toBe(1);
  });

  it('is one for the listings made at once', async () => {
    const fake = await fakeServer();
    const access = accessTo({ graph: remote(fake) });

    await Promise.all([Effect.runPromise(access.listServers(alpha)), Effect.runPromise(access.listServers(alpha))]);

    expect(fake.seen().filter(({ rpc }) => rpc === 'initialize')).toHaveLength(1);
    expect(fake.endedSessions()).toBe(1);
  });

  it('is ended once the listing settles, when the listing is interrupted as it opens', async () => {
    const fake = await fakeServer();
    const access = accessTo({ graph: remote(fake) });

    const listing = Effect.runFork(access.listServers(alpha));
    await initializing(fake);
    await Effect.runPromise(Fiber.interrupt(listing));

    expect(await sessionsEnded(fake)).toBe(1);
    expect(fake.openSessions()).toBe(0);
  });
});

describe('the secrets of a tool server', () => {
  it('never show in a listing, even where the server repeats one in what it lists', async () => {
    const fake = await serveFakeMcp();
    closing.push(fake.close);
    const headers = { 'X-Graph-Key': '${GRAPH_KEY}', 'X-Graph-Look': '${GRAPH_LOOK}', 'X-Region': 'production-eu' };
    const environment = { GRAPH_KEY: 'rows of the graph', GRAPH_LOOK: 'What to look for' };

    const listing = await listed(
      { graph: { url: fake.url, headers, org: 'acme' } },
      { allowed: ['graph/search'], environment },
    );
    const text = JSON.stringify(listing);

    expect(listing).toEqual([
      {
        name: 'graph',
        type: 'http',
        tools: [
          {
            name: 'search',
            description: 'Finds the [redacted] that match a query.',
            input_schema: {
              ...searchTool.input_schema,
              properties: { query: { type: 'string', description: '[redacted]' } },
            },
          },
        ],
      },
    ]);
    expect(text).not.toContain('production-eu');
    expect(text).not.toContain(fake.url);
  });
});
