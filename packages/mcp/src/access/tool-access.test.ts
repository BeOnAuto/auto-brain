import { Effect, Option, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  controlledSignals,
  fakeStdioServerPath,
  fakeToolNames,
  longToolName,
  patientTiming,
  recordingCallJournal,
  reportingAccess,
  serveFakeMcp,
  stdioTestTimeoutMs,
  toolRun,
  toolRunId,
  type FakeMcpOptions,
  type FakeMcpServer,
} from '../testing/index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
}, stdioTestTimeoutMs);

async function fakeServer(options?: FakeMcpOptions): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp(options);
  closing.push(fake.close);
  return fake;
}

function accessTo(servers: Readonly<Record<string, unknown>>, allowed?: readonly string[]) {
  const reporting = reportingAccess(servers, {
    environment: { GRAPH_API_KEY: apiKey, NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] },
    timing: patientTiming,
    ...(allowed === undefined ? {} : { allowed }),
  });
  closing.push(reporting.access.close);
  return reporting;
}

const graphOf = (fake: FakeMcpServer, changes: Readonly<Record<string, unknown>> = {}) => ({
  url: fake.url,
  headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
  org: 'acme',
  ...changes,
});

const limitless = {
  command: process.execPath,
  args: [fakeStdioServerPath],
  env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
  org: 'acme',
};

function opened(access: ReturnType<typeof accessTo>['access'], ...written: readonly string[]) {
  const references = written.map((each) => {
    const [server = '', tool = ''] = each.split('/');
    return { server, tool };
  });
  return Effect.runPromise(Effect.result(access.open(toolRun(recordingCallJournal()), references)));
}

async function offeredBy(access: ReturnType<typeof accessTo>['access'], ...written: readonly string[]) {
  const tools = Result.getOrThrow(await opened(access, ...written));
  closing.push(tools.close);
  return tools;
}

async function refusalOf(access: ReturnType<typeof accessTo>['access'], ...written: readonly string[]) {
  return Option.getOrUndefined(Result.getFailure(await opened(access, ...written)));
}

const hashedLongName: unknown = expect.stringMatching(
  /^mcp__graph__a_tool_whose_name_is_much_longer_than_the_s_[0-9a-f]{8}$/u,
);

describe('the tools a run is offered', () => {
  it('offers the tools a reasoning function names under their model-facing names, with their schemas unchanged', async () => {
    const fake = await fakeServer({ bearer: apiKey });
    const { access } = accessTo({ graph: graphOf(fake) });

    const tools = await offeredBy(access, 'graph/search', 'graph/profile', `graph/${longToolName}`);

    expect(access.configured).toBe(true);
    expect(tools.offered.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).toEqual([
      {
        name: 'mcp__graph__search',
        description: 'Finds the rows of the graph that match a query.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'What to look for' } },
          required: ['query'],
        },
      },
      { name: 'mcp__graph__profile', description: '', inputSchema: { type: 'object', properties: {}, required: [] } },
      {
        name: hashedLongName,
        description: 'A tool whose name is longer than a provider takes.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
    ]);
  });

  it('maps a model-facing name back to the tool on its server', async () => {
    const fake = await fakeServer({ bearer: apiKey });
    const { access } = accessTo({ graph: graphOf(fake) });
    const tools = await offeredBy(access, 'graph/graph.query.v2', `graph/${longToolName}`);
    const [dotted, long] = tools.offered;

    const replies = [
      await dotted?.call({ callId: 'call-1', input: { query: 'acme' } }, controlledSignals()),
      await long?.call({ callId: 'call-2', input: {} }, controlledSignals()),
    ];

    expect(dotted?.name).toBe('mcp__graph__graph_query_v2');
    expect(replies).toEqual([
      { text: 'Queried acme.', isError: false },
      { text: 'Answered from far away.', isError: false },
    ]);
    expect(fake.received()).toEqual([
      { tool: 'graph.query.v2', arguments: { query: 'acme' }, meta: { 'com.beonauto/execution_id': toolRunId } },
      { tool: longToolName, arguments: {}, meta: { 'com.beonauto/execution_id': toolRunId } },
    ]);
  });
});

describe('the tools of server/*', () => {
  it('offers every tool of a server for server/*, or every tool the operator allows', async () => {
    const fake = await fakeServer({ bearer: apiKey });
    const { access } = accessTo({ graph: graphOf(fake) });
    const { access: narrowed } = accessTo({ graph: graphOf(fake) }, ['graph/search', 'graph/echo']);

    const every = await offeredBy(access, 'graph/*', 'graph/search');
    const allowed = await offeredBy(narrowed, 'graph/*');

    expect(every.offered).toHaveLength(fakeToolNames.length);
    expect(allowed.offered.map(({ name }) => name)).toEqual(['mcp__graph__search', 'mcp__graph__echo']);
  });

  it('offers no tool when no server is configured', () => {
    const { access } = accessTo({});

    expect(access.configured).toBe(false);
  });
});

describe('a server that cannot be used', () => {
  it('cannot be reached', async () => {
    const fake = await serveFakeMcp();
    await fake.close();
    const { access } = accessTo({ graph: graphOf(fake) });

    expect(await refusalOf(access, 'graph/search')).toMatchObject({
      _tag: 'mcp_server_failed',
      because: 'unreachable',
      detail: 'The MCP server graph could not be used: The MCP server could not be reached',
    });
  });

  it('keeps failing, or asks to slow down, while the other servers are let go', async () => {
    const fake = await fakeServer({ bearer: apiKey });
    const other = await fakeServer({ bearer: apiKey });
    const { access } = accessTo({ graph: graphOf(fake), wiki: graphOf(other) });

    fake.answerNextWith(503);
    const failing = await refusalOf(access, 'graph/search', 'wiki/search');
    fake.answerNextWith(429);
    const limited = await refusalOf(access, 'graph/search');

    expect(failing).toMatchObject({ _tag: 'mcp_server_failed', because: 'failing' });
    expect(limited).toMatchObject({ _tag: 'mcp_server_failed', because: 'rate_limited' });
    expect(other.endedSessions()).toBe(1);
    expect(other.openSessions()).toBe(0);
  });

  it('fails to list its tools on a session another run holds, which that run keeps', async () => {
    const fake = await fakeServer({ bearer: apiKey });
    const { access } = accessTo({ graph: graphOf(fake) });
    const holding = await offeredBy(access, 'graph/search');

    fake.answerNextWith(503);
    const failing = await refusalOf(access, 'graph/search');
    const reply = await holding.offered[0]?.call({ callId: 'call-1', input: { query: 'acme' } }, controlledSignals());

    expect(failing).toMatchObject({ _tag: 'mcp_server_failed', because: 'failing' });
    expect(reply).toEqual({ text: 'Found 2 rows for acme.', isError: false });
  });
});

describe('the sessions of runs', () => {
  it('shares one session between runs and ends it when the last run closes', async () => {
    const fake = await fakeServer({ bearer: apiKey });
    const { access } = accessTo({ graph: graphOf(fake) });

    const first = await offeredBy(access, 'graph/search');
    const second = await offeredBy(access, 'graph/echo');
    await first.close();
    const openAfterFirst = fake.openSessions();
    await second.close();

    expect(openAfterFirst).toBe(1);
    expect(fake.openSessions()).toBe(0);
    expect(fake.endedSessions()).toBe(1);
  });

  it('keeps the tools it listed for the run when the server says they changed', async () => {
    const fake = await fakeServer({ bearer: apiKey });
    const { access } = accessTo({ graph: graphOf(fake) });
    const tools = await offeredBy(access, 'graph/*');

    fake.removeTool('search');
    fake.notifyToolsChanged();
    const reply = await tools.offered[0]?.call({ callId: 'call-1', input: { query: 'acme' } }, controlledSignals());

    expect(tools.offered).toHaveLength(fakeToolNames.length);
    expect(reply).toEqual({ text: 'Tool search not found', isError: true });
  });
});

describe('a stdio server and the MCP client', { timeout: stdioTestTimeoutMs }, () => {
  it('starts a stdio server once for every run, and stops it when the access closes', async () => {
    const { access, messages } = accessTo({ limitless });

    const first = await offeredBy(access, 'limitless/search');
    const second = await offeredBy(access, 'limitless/echo');
    const reply = await second.offered[0]?.call({ callId: 'call-1', input: { said: 'hello' } }, controlledSignals());
    await first.close();
    await second.close();
    await access.close();

    expect(reply).toEqual({ text: '{"said":"hello"}', isError: false });
    expect(messages()).toContainEqual({
      server: 'limitless',
      message: 'The fake MCP server says line 1 on stderr',
      execution_id: null,
    });
  });

  it('reports the errors the MCP client meets as messages of their server', async () => {
    const { access, messages } = accessTo({
      limitless: { ...limitless, args: [fakeStdioServerPath, '--stdout', '{"not":"rpc"}\n'] },
    });

    const tools = await offeredBy(access, 'limitless/search');
    await tools.close();

    expect(messages()).toContainEqual({
      server: 'limitless',
      message: 'The MCP server wrote a message that is not JSON-RPC',
      execution_id: null,
    });
  });
});
