import { outputConformsTo, problemIn, toolNamesIn, withMcpSession, type McpConnection } from '@beonauto/api/testing';
import { createApiKey } from '@beonauto/identity';
import { allPermissions } from '@beonauto/operations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { release } from '../composition/release.ts';
import { startServer, type RunningServer } from '../lifecycle/lifecycle.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' });

const acmeReader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['org:read'], brains: '*' });

const acmeAlpha = createApiKey({ id: 'acme-alpha', org: 'acme', permissions: allPermissions, brains: ['alpha'] });

const apiKeys = JSON.stringify([acmeAdmin.entry, acmeReader.entry, acmeAlpha.entry]);

const brainTools = ['create_brain', 'list_brains', 'get_brain', 'update_brain', 'retire_brain'];

const specTools = [
  'create_spec',
  'list_specs',
  'get_spec',
  'update_spec',
  'retire_spec',
  'execute_spec',
  'get_execution',
  'cancel_execution',
  'list_executions',
  'get_execution_history',
  'get_brain_analytics',
  'list_brain_events',
  'publish_event',
  'list_tool_servers',
  'test_tool_call',
  'answer_interaction',
  'list_interactions',
  'send_execution_event',
];

let ledger: TemporaryLedger;
let server: RunningServer;

beforeEach(async () => {
  ledger = temporaryLedger();
  server = await startServer(
    { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName, API_KEYS: apiKeys },
    compositionRoot,
  );
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

function endpoint(path: string, key: string): McpConnection {
  return { url: `http://127.0.0.1:${server.port}${path}`, headers: { authorization: `Bearer ${key}` } };
}

function postInitialize(path: string, headers: Readonly<Record<string, string>>): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'server-tests', version: '1' } },
    }),
  });
}

describe('the org endpoint of the server', () => {
  it('names the release and lists the five brain tools and list_models', async () => {
    const connected = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/mcp', acmeAdmin.key),
      async (session) => ({
        serverVersion: session.serverVersion,
        tools: toolNamesIn(await session.listTools()),
      }),
    );

    expect(connected).toEqual({ serverVersion: release, tools: [...brainTools, 'list_models', 'get_guide'] });
  });

  it('answers a brain the org lacks as isError with a not_found problem', async () => {
    const missing = await withMcpSession('previous revision', endpoint('/orgs/acme/mcp', acmeAdmin.key), (session) =>
      session.callTool('get_brain', { brain: 'nowhere' }),
    );

    expect({ isError: missing.isError, problem: problemIn(missing) }).toMatchObject({
      isError: true,
      problem: { status: 404, reason: 'not_found' },
    });
  });
});

describe('the brain tools of the server', () => {
  it('create, list, read, update and retire a brain, each output conforming to its schema', async () => {
    const outcome = await withMcpSession(
      'previous major',
      endpoint('/orgs/acme/mcp', acmeAdmin.key),
      async (session) => ({
        listing: await session.listTools(),
        created: await session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }),
        listed: await session.callTool('list_brains', {}),
        read: await session.callTool('get_brain', { brain: 'alpha' }),
        updated: await session.callTool('update_brain', { brain: 'alpha', name: 'Alpha prime', description: 'Notes' }),
        retired: await session.callTool('retire_brain', { brain: 'alpha' }),
      }),
    );
    const { listing } = outcome;

    expect(outcome.created.structuredContent).toMatchObject({ id: 'alpha', name: 'Alpha', status: 'active' });
    expect(outcome.listed.structuredContent).toMatchObject({ brains: [{ id: 'alpha' }] });
    expect(outcome.read.structuredContent).toEqual(outcome.created.structuredContent);
    expect(outcome.updated.structuredContent).toMatchObject({ name: 'Alpha prime', description: 'Notes' });
    expect(outcome.retired.structuredContent).toMatchObject({ status: 'retired' });
    expect([
      outputConformsTo(listing, 'create_brain', outcome.created.structuredContent),
      outputConformsTo(listing, 'list_brains', outcome.listed.structuredContent),
      outputConformsTo(listing, 'get_brain', outcome.read.structuredContent),
      outputConformsTo(listing, 'update_brain', outcome.updated.structuredContent),
      outputConformsTo(listing, 'retire_brain', outcome.retired.structuredContent),
    ]).toEqual([true, true, true, true, true]);
  });
});

describe('the callers the MCP endpoints of the server reject before MCP', () => {
  it('answers a request without a key with a 401 problem document before MCP', async () => {
    const answer = await postInitialize('/orgs/acme/mcp', {});

    expect({ status: answer.status, type: answer.headers.get('content-type') }).toEqual({
      status: 401,
      type: 'application/problem+json',
    });
  });

  it('rejects a key of another org with a 403 problem document', async () => {
    const answer = await postInitialize('/orgs/globex/mcp', { authorization: `Bearer ${acmeAdmin.key}` });

    expect({ status: answer.status, body: await answer.json() }).toMatchObject({
      status: 403,
      body: { reason: 'forbidden', detail: 'The caller does not belong to this org' },
    });
  });
});

describe('the permissions and brains of a key over MCP', () => {
  it('offer a read-only key the queries of the org and no command, and serve it a query', async () => {
    const outcome = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/mcp', acmeReader.key),
      async (session) => ({
        tools: toolNamesIn(await session.listTools()),
        listed: await session.callTool('list_brains', {}),
      }),
    );

    expect(outcome.tools).toEqual(['list_brains', 'get_brain', 'list_models', 'get_guide']);
    expect(outcome.listed.structuredContent).toEqual({ brains: [] });
  });

  it('confine a key limited to some brains to the brain endpoints of those brains', async () => {
    const other = await postInitialize('/orgs/acme/brains/beta/mcp', { authorization: `Bearer ${acmeAlpha.key}` });
    const own = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/brains/alpha/mcp', acmeAlpha.key),
      (session) => session.listTools(),
    );

    expect({ status: other.status, body: await other.json() }).toMatchObject({
      status: 403,
      body: { detail: 'The caller may not access this brain' },
    });
    expect(toolNamesIn(own)).toEqual([...specTools, 'get_guide']);
  });

  it('lists the spec tools on the brain endpoint of a brain that does not exist, whose calls find no brain', async () => {
    const { tools, listed } = await withMcpSession(
      'previous major',
      endpoint('/orgs/acme/brains/nowhere/mcp', acmeAdmin.key),
      async (session) => ({
        tools: await session.listTools(),
        listed: await session.callTool('list_specs', { primitive: 'inference' }),
      }),
    );

    expect(toolNamesIn(tools)).toEqual([...specTools, 'get_guide']);
    expect({ isError: listed.isError, problem: problemIn(listed) }).toMatchObject({
      isError: true,
      problem: { reason: 'not_found' },
    });
  });
});
