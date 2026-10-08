import { setTimeout } from 'node:timers/promises';

import {
  listedTools,
  outputConformsTo,
  plainTextIn,
  problemIn,
  withMcpSession,
  type McpSession,
} from '@beonauto/api/testing';
import { createApiKey } from '@beonauto/identity';
import { serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import { allPermissions } from '@beonauto/operations';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, brains: '*' });

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['org:read', 'brain:read'], brains: '*' });

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Serving {
  readonly server: ReasoningServer;
  readonly graph: FakeMcpServer;
}

async function serving(settings: Readonly<Record<string, string>> = {}): Promise<Serving> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  closing.push(graph.close);
  const server = await servingReasoning([], {
    API_KEYS: JSON.stringify([builder.entry, reader.entry]),
    GRAPH_API_KEY: apiKey,
    MCP_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
    ...settings,
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/brains', { key: builder.key, body: { brain: 'alpha', name: 'Alpha' } });
  return { server, graph };
}

function on<T>(server: ReasoningServer, path: string, key: string, use: (session: McpSession) => Promise<T>) {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}${path}`, headers: { authorization: `Bearer ${key}` } },
    use,
  );
}

function annotationsOn(server: ReasoningServer) {
  return on(server, '/mcp', builder.key, async (session) =>
    listedTools(await session.listTools()).find(({ name }) => name === 'test_tool_call'),
  );
}

const searched = { server: 'graph', tool: 'search', arguments: { query: 'acme' } };

const answered = { server: 'graph', tool: 'search', outcome: 'result', text: 'Found 2 rows for acme.' };

describe('test_tool_call over MCP', () => {
  it('is served on /mcp with the brain as an argument and on the brain endpoint, never on the org endpoint', async () => {
    const { server } = await serving();

    const { all, tested } = await on(server, '/mcp', builder.key, async (session) => ({
      all: await session.listTools(),
      tested: await session.callTool('test_tool_call', { brain: 'alpha', ...searched }),
    }));
    const onTheBrain = await on(server, '/orgs/acme/brains/alpha/mcp', builder.key, (session) =>
      session.callTool('test_tool_call', searched),
    );
    const onTheOrg = await on(server, '/orgs/acme/mcp', builder.key, (session) => session.listTools());

    expect([tested.structuredContent, onTheBrain.structuredContent]).toMatchObject([answered, answered]);
    expect(outputConformsTo(all, 'test_tool_call', tested.structuredContent)).toBe(true);
    expect(plainTextIn(tested)).toMatch(
      /^The tool “search” of “graph” answered in [\d,]+ ms with \d+ bytes; what a reasoning function's model would see is in the details\.$/u,
    );
    expect(listedTools(onTheOrg).map(({ name }) => name)).not.toContain('test_tool_call');
  });

  it('says whether a test may change something by whether whoever runs the server lists a tool as safe to test', async () => {
    const plain = await serving();
    const listing = await serving({ TESTABLE_TOOLS: JSON.stringify(['graph/echo']) });
    expect([await annotationsOn(plain.server), await annotationsOn(listing.server)]).toMatchObject([
      {
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
    ]);
  });
});

describe('test_tool_call refused over MCP', () => {
  it('says in plain words why a tool cannot be tested and what whoever runs the server can do', async () => {
    const { server, graph } = await serving();

    const refused = await on(server, '/orgs/acme/brains/alpha/mcp', builder.key, (session) =>
      session.callTool('test_tool_call', { server: 'graph', tool: 'echo' }),
    );

    expect(refused.isError).toBe(true);
    expect(problemIn(refused)).toMatchObject({
      reason: 'unavailable',
      kind: 'tool_not_offered',
      because: 'not_testable',
    });
    expect(plainTextIn(refused)).toBe(
      "Could not test the tool “echo” of “graph”: this server does not offer a tool it names, because by its server's own account it may change something, and whoever runs the server has not listed it as safe to test. Nothing was changed. A tool that may change something is called only by a function the person asked to run; whoever runs the server can list it under testable_tools, and list_tool_servers shows which tools can be tested.",
    );
    expect(graph.received()).toEqual([]);
  });

  it('says to name a tool server that list_tool_servers shows when none of the name serves the brain', async () => {
    const { server, graph } = await serving();

    const refused = await on(server, '/orgs/acme/brains/alpha/mcp', builder.key, (session) =>
      session.callTool('test_tool_call', { server: 'wiki', tool: 'search' }),
    );

    expect(problemIn(refused)).toMatchObject({ kind: 'tool_not_offered', because: 'mcp_server_not_configured' });
    expect(plainTextIn(refused)).toBe(
      'Could not test the tool “search” of “wiki”: this server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this brain. Nothing was changed. This can be put right on your side: list_tool_servers shows the tool servers this brain may use, so a test that names one of those can be tried.',
    );
    expect(graph.seen()).toEqual([]);
  });
});

describe('test_tool_call for a key that may only read', () => {
  it('is not offered on either endpoint, and the instructions say nothing of it', async () => {
    const { server } = await serving();

    const seen = await Promise.all(
      ['/mcp', '/orgs/acme/brains/alpha/mcp'].map((path) =>
        on(server, path, reader.key, async (session) => {
          const tools = listedTools(await session.listTools()).map(({ name }) => name);
          return `${tools.join(' ')}\n${String(session.instructions)}`;
        }),
      ),
    );

    expect(seen.filter((offered) => offered.includes('test_tool_call'))).toEqual([]);
    expect(seen.filter((offered) => offered.includes('list_tool_servers'))).toHaveLength(2);
  });
});

async function until(holds: () => boolean, waited = 0): Promise<boolean> {
  if (holds() || waited >= 5000) {
    return holds();
  }
  await setTimeout(10);
  return until(holds, waited + 10);
}

describe('a test whose caller goes away over MCP while the tool is called', () => {
  it('records a start and no answer, sends no second call, and still lets the session go', async () => {
    const { server, graph } = await serving();
    const leaving = new AbortController();
    const call = { name: 'test_tool_call', arguments: { server: 'graph', tool: 'sleep', arguments: { ms: 5000 } } };

    const gone: Promise<unknown> = fetch(`${server.origin}/orgs/acme/brains/alpha/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${builder.key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: call }),
      signal: leaving.signal,
    }).catch((error: unknown) => error);
    await until(() => graph.received().length === 1);
    leaving.abort();
    await gone;

    expect(await until(() => graph.endedSessions() === 1)).toBe(true);
    const events = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
    expect(events.body).toMatchObject({ events: [{ type: 'tool_test_started' }] });
    expect(events.body).not.toMatchObject({ events: [{}, {}] });
    expect(graph.received()).toHaveLength(1);
  });
});
