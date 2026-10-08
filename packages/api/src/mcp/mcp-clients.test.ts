import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { instructionsFor } from '../index.ts';
import { testDefinitionTypes, testRecipes } from '../testing/guides.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import {
  expectedProtocolVersion,
  mcpClientKinds,
  problemIn,
  textOf,
  withMcpSession,
  type McpConnection,
} from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer, testServerInfo, type OperationServer } from '../testing/operation-server.ts';
import { outputConformsTo, toolNamesIn } from '../testing/tool-listing.ts';

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer();
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function alphaEndpoint(): McpConnection {
  return {
    url: `${listening.origin}/orgs/acme/brains/alpha/mcp`,
    headers: { authorization: `Bearer ${acmeAdmin.key}` },
  };
}

const brainTools = [
  'add_note',
  'check_lines',
  'list_notes',
  'get_note',
  'latest_note',
  'break_down',
  'wait_forever',
  'send_notes',
];

const internalProblem = {
  type: 'https://on.auto/problems/internal',
  title: 'Internal error',
  status: 500,
  detail: 'An unexpected error occurred',
  reason: 'internal',
};

describe.each(mcpClientKinds)('the %s client connecting to a brain endpoint', (kind) => {
  it('negotiates the expected revision and learns the server identity and the instructions', async () => {
    const connected = await withMcpSession(kind, alphaEndpoint(), (session) =>
      Promise.resolve({
        protocolVersion: session.protocolVersion,
        serverVersion: session.serverVersion,
        instructions: session.instructions,
      }),
    );

    expect(connected).toEqual({
      protocolVersion: expectedProtocolVersion[kind],
      serverVersion: testServerInfo,
      instructions: instructionsFor('brain', { orgTools: [], brainTools }, testDefinitionTypes, testRecipes),
    });
  });

  it('lists one tool per brain operation', async () => {
    expect(toolNamesIn(await withMcpSession(kind, alphaEndpoint(), (session) => session.listTools()))).toEqual([
      ...brainTools,
      'get_guide',
    ]);
  });
});

describe.each(mcpClientKinds)('the %s client calling tools that succeed', (kind) => {
  it('calls a command and a query, whose structured content conforms to the output schema', async () => {
    const name = `note-${kind.replaceAll(' ', '-')}`;

    const outcome = await withMcpSession(kind, alphaEndpoint(), async (session) => ({
      listing: await session.listTools(),
      added: await session.callTool('add_note', { name, text: 'hello' }),
      read: await session.callTool('get_note', { name }),
    }));

    expect(outcome.added).toEqual({
      content: [
        { type: 'text', text: `Added the note “${name}”.` },
        { type: 'text', text: JSON.stringify({ name, text: 'hello' }) },
      ],
      structuredContent: { name, text: 'hello' },
    });
    expect(outcome.read.structuredContent).toEqual({ name, text: 'hello' });
    expect(outputConformsTo(outcome.listing, 'get_note', outcome.read.structuredContent)).toBe(true);
  });
});

describe.each(mcpClientKinds)('the %s client calling tools that do not succeed', (kind) => {
  it('gets a rejection as isError with the problem document as text and no structured content', async () => {
    const rejected = await withMcpSession(kind, alphaEndpoint(), (session) =>
      session.callTool('get_note', { name: 'missing' }),
    );

    expect({ isError: rejected.isError, structuredContent: rejected.structuredContent }).toEqual({
      isError: true,
      structuredContent: undefined,
    });
    expect(problemIn(rejected)).toEqual({
      type: 'https://on.auto/problems/not_found',
      title: 'Not found',
      status: 404,
      detail: 'There is no note missing',
      reason: 'not_found',
    });
  });

  it('gets a failure as isError with an internal problem identified only by its instance', async () => {
    const failed = await withMcpSession(kind, alphaEndpoint(), (session) => session.callTool('break_down', {}));

    expect({ isError: failed.isError, structuredContent: failed.structuredContent }).toEqual({
      isError: true,
      structuredContent: undefined,
    });
    expect(problemIn(failed)).toMatchObject(internalProblem);
    expect(textOf(failed)).toMatch(/"instance":"urn:uuid:[\da-f-]{36}"\}$/u);
    expect(textOf(failed)).not.toContain('hunter2');
  });

  it('gets invalid arguments as isError with an invalid_input problem pointing at them', async () => {
    const rejected = await withMcpSession(kind, alphaEndpoint(), (session) =>
      session.callTool('add_note', { name: 42 }),
    );

    expect(rejected.isError).toBe(true);
    expect(problemIn(rejected)).toMatchObject({
      reason: 'invalid_input',
      errors: [{ pointer: '/name' }, { pointer: '/text' }],
    });
  });

  it('gets a protocol error for a tool the endpoint does not list', async () => {
    await expect(
      withMcpSession(kind, alphaEndpoint(), (session) => session.callTool('no_such_tool', {})),
    ).rejects.toThrow('Tool no_such_tool not found');
  });
});
