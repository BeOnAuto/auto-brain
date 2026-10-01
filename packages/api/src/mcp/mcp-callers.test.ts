import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { problemIn, withMcpSession, type McpConnection, type ToolResult } from '../testing/mcp-clients.ts';
import { acmeAlphaWriter, acmeReader, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { listedTools } from '../testing/tool-listing.ts';

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

function endpoint(path: string, key: string): McpConnection {
  return { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${key}` } };
}

function problemOf(result: ToolResult): unknown {
  return { isError: result.isError, problem: problemIn(result) };
}

describe('the permissions of the caller of a tool', () => {
  it('reject a command of a read-only key as isError, and serve it a query', async () => {
    const outcome = await withMcpSession(
      'previous major',
      endpoint('/orgs/acme/brains/alpha/mcp', acmeReader.key),
      async (session) => ({
        command: await session.callTool('add_note', { name: 'read-only', text: 'no' }),
        query: await session.callTool('list_notes'),
      }),
    );

    expect(problemOf(outcome.command)).toEqual({
      isError: true,
      problem: {
        type: 'https://on.auto/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'The caller lacks the brain:write permission',
        reason: 'forbidden',
      },
    });
    expect(outcome.query.isError).toBeUndefined();
  });

  it('let a key limited to some brains call the tools of a brain it may access', async () => {
    const added = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/brains/alpha/mcp', acmeAlphaWriter.key),
      (session) => session.callTool('add_note', { name: 'limited', text: 'yes' }),
    );

    expect(added.structuredContent).toEqual({ name: 'limited', text: 'yes' });
  });

  it('confine an org tool of a key limited to some brains to those brains', async () => {
    const labelled = await withMcpSession(
      'previous revision',
      endpoint('/orgs/acme/mcp', acmeAlphaWriter.key),
      async (session) => ({
        own: await session.callTool('label_brain', { brain: 'alpha', label: 'a' }),
        other: await session.callTool('label_brain', { brain: 'beta', label: 'b' }),
      }),
    );

    expect(labelled.own.structuredContent).toEqual({ brain: 'alpha', label: 'a' });
    expect(problemOf(labelled.other)).toMatchObject({ isError: true, problem: { reason: 'forbidden' } });
  });
});

describe('the brain endpoint of a brain that does not exist', () => {
  it('lists the brain tools and answers a call with a not_found problem', async () => {
    const outcome = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/brains/nowhere/mcp', acmeReader.key),
      async (session) => ({
        tools: listedTools(await session.listTools()).length,
        called: await session.callTool('list_notes'),
      }),
    );

    expect(outcome.tools).toBeGreaterThan(0);
    expect(problemOf(outcome.called)).toEqual({
      isError: true,
      problem: {
        type: 'https://on.auto/problems/not_found',
        title: 'Not found',
        status: 404,
        detail: 'There is no brain nowhere in this org',
        reason: 'not_found',
      },
    });
  });
});
