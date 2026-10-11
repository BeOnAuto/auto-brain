import {
  internalTermsIn,
  listedTools,
  plainTextIn,
  problemIn,
  withMcpSession,
  type McpSession,
} from '@beonauto/api/testing';
import { serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Serving {
  readonly server: ReasoningServer;
  readonly graph: FakeMcpServer;
  readonly others: FakeMcpServer;
}

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function remote(fake: FakeMcpServer, changes: Readonly<Record<string, unknown>>) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, ...changes };
}

async function serving(): Promise<Serving> {
  const graph = await fakeServer();
  const others = await fakeServer();
  const gone = await serveFakeMcp();
  await gone.close();
  const server = await servingReasoning([], {
    LOCAL_MODE: 'true',
    GRAPH_API_KEY: apiKey,
    MCP_SERVERS: JSON.stringify({
      graph: {
        url: graph.url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Region': 'production-eu' },
        org: 'acme',
        allowed: ['search', 'echo'],
      },
      crm: remote(others, { org: 'globex' }),
      sales: remote(others, { org: 'acme', brains: ['sales'] }),
      wiki: { url: gone.url, org: 'acme', brains: ['alpha'], record_content: false },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  return { server, graph, others };
}

const listedForAlpha = {
  tool_servers: [
    {
      name: 'graph',
      type: 'http',
      record_content: true,
      tools: [
        {
          name: 'search',
          description: 'Finds the rows of the graph that match a query.',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string', description: 'What to look for' } },
            required: ['query'],
          },
          annotations: { readOnlyHint: true, openWorldHint: true },
          testable: true,
        },
        {
          name: 'echo',
          description: 'Answers with its arguments.',
          input_schema: { type: 'object', properties: {}, required: [] },
          testable: false,
        },
      ],
    },
    {
      name: 'wiki',
      type: 'http',
      record_content: false,
      unavailable: 'The MCP server wiki could not be used: The MCP server could not be reached',
      because: 'unreachable',
    },
  ],
};

const listedInWords =
  "This brain's functions may use 2 tool servers. “graph” offers 2 tools: search and echo; search can be tested. “wiki” could not be asked for its tools just now.";

function onBrain<T>(server: ReasoningServer, brain: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/brains/${brain}/mcp`, headers: {} },
    use,
  );
}

describe('list_tool_servers over HTTP', () => {
  it('lists the servers the brain may use, with the tools the operator allows, and one it cannot reach as unavailable', async () => {
    const { server, graph, others } = await serving();

    const listed = await server.call('GET', `${alpha}/tool-servers`);
    const named = await server.call('GET', `${alpha}/tool-servers?server=wiki`);

    expect(listed).toMatchObject({ status: 200, body: listedForAlpha });
    expect(named).toMatchObject({ status: 200, body: { tool_servers: listedForAlpha.tool_servers.slice(1) } });
    expect(graph.openSessions()).toBe(0);
    expect(others.seen()).toEqual([]);
  });

  it('shows no header value and no secret of a server', async () => {
    const { server, graph } = await serving();

    const { body } = await server.call('GET', `${alpha}/tool-servers`);
    const text = JSON.stringify(body);

    expect(text).not.toContain(apiKey);
    expect(text).not.toContain('production-eu');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain(graph.url);
  });

  it('answers a brain the org does not have as not_found, and a retired brain as every read does', async () => {
    const { server } = await serving();

    const missing = await server.call('GET', '/v1/orgs/acme/brains/nowhere/tool-servers');
    await server.call('POST', `${alpha}/retire`);
    const retired = await server.call('GET', `${alpha}/tool-servers`);

    expect(missing).toMatchObject({ status: 404, body: { reason: 'not_found' } });
    expect(retired).toMatchObject({ status: 200, body: listedForAlpha });
  });
});

function refusedAs(name: string) {
  return {
    status: 422,
    body: {
      reason: 'invalid_input',
      errors: [
        {
          detail: `This brain has no tool server named ${name}; call list_tool_servers without server to list the ones it has`,
          pointer: '/server',
        },
      ],
    },
  };
}

describe('list_tool_servers over HTTP, asked for one server', () => {
  it('refuses the name of a server of another org, or of other brains of the org, and asks no server', async () => {
    const { server, graph, others } = await serving();

    const otherOrg = await server.call('GET', `${alpha}/tool-servers?server=crm`);
    const otherBrain = await server.call('GET', `${alpha}/tool-servers?server=sales`);

    expect(otherOrg).toMatchObject(refusedAs('crm'));
    expect(otherBrain).toMatchObject(refusedAs('sales'));
    expect([...graph.seen(), ...others.seen()]).toEqual([]);
  });
});

describe('list_tool_servers over MCP', () => {
  it('is a read-only tool of the brain that lists the same, led by plain words', async () => {
    const { server } = await serving();

    const { tools, listed } = await onBrain(server, 'alpha', async (session) => ({
      tools: await session.listTools(),
      listed: await session.callTool('list_tool_servers', {}),
    }));

    expect(listedTools(tools).find(({ name }) => name === 'list_tool_servers')?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(listed.structuredContent).toEqual(listedForAlpha);
    expect(plainTextIn(listed)).toBe(listedInWords);
    expect(internalTermsIn(plainTextIn(listed))).toEqual([]);
  });

  it('answers a brain the org does not have as not_found, and a retired brain as every read does', async () => {
    const { server } = await serving();

    const missing = await onBrain(server, 'nowhere', (session) => session.callTool('list_tool_servers', {}));
    await server.call('POST', `${alpha}/retire`);
    const retired = await onBrain(server, 'alpha', (session) => session.callTool('list_tool_servers', {}));

    expect({ isError: missing.isError, problem: problemIn(missing) }).toMatchObject({
      isError: true,
      problem: { reason: 'not_found' },
    });
    expect(retired.structuredContent).toEqual(listedForAlpha);
  });
});

const [graphOfAlpha, wikiOfAlpha] = listedForAlpha.tool_servers;

const graphInTheOrg = { ...graphOfAlpha, brains: ['*'] };

const wikiInTheOrg = { ...wikiOfAlpha, brains: ['alpha'] };

const salesInTheOrg = { name: 'sales', type: 'http', brains: ['sales'] };

describe('list_tool_servers of the org over HTTP', () => {
  it('lists every server of the org with the brains it serves, or those that serve the brain asked for', async () => {
    const { server } = await serving();

    const listed = await server.call('GET', '/v1/orgs/acme/tool-servers');
    const forAlpha = await server.call('GET', '/v1/orgs/acme/tool-servers?brain=alpha');

    expect(listed).toMatchObject({
      status: 200,
      body: { tool_servers: [graphInTheOrg, salesInTheOrg, wikiInTheOrg] },
    });
    expect(forAlpha).toMatchObject({ status: 200, body: { tool_servers: [graphInTheOrg, wikiInTheOrg] } });
  });
});

function listedOnTheOrgEndpoint(server: ReasoningServer) {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/mcp`, headers: {} },
    async (session) => ({
      inOrg: await session.callTool('list_tool_servers', {}),
      inAlpha: await session.callTool('list_tool_servers', { brain: 'alpha' }),
    }),
  );
}

describe('list_tool_servers on the org endpoint, without a brain and with one', () => {
  it('answers for the org and for the brain', async () => {
    const { server } = await serving();

    const { inOrg, inAlpha } = await listedOnTheOrgEndpoint(server);

    expect(inOrg.structuredContent).toMatchObject({ tool_servers: [graphInTheOrg, salesInTheOrg, wikiInTheOrg] });
    expect(inAlpha.structuredContent).toEqual({ tool_servers: [graphInTheOrg, wikiInTheOrg] });
    expect(plainTextIn(inAlpha)).toBe(listedInWords);
    expect(plainTextIn(inOrg)).toMatch(
      /^The brains of this org may use 3 tool servers\. “graph”, for every brain, offers 2 tools: search and echo;/u,
    );
  });
});
