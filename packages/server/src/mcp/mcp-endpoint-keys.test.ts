import {
  mcpClientKinds,
  problemIn,
  toolNamesIn,
  withMcpSession,
  type McpClientKind,
  type McpSession,
} from '@beonauto/api/testing';
import { createApiKey } from '@beonauto/identity';
import { allPermissions } from '@beonauto/operations';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/reasoning-server.ts';

const listResultOf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ result: Schema.Unknown })));

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' });

const acmeReader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'brain:read'],
  brains: '*',
});

const acmeAlpha = createApiKey({ id: 'acme-alpha', org: 'acme', permissions: allPermissions, brains: ['alpha'] });

const globexAdmin = createApiKey({ id: 'globex-admin', org: 'globex', permissions: allPermissions, brains: '*' });

const apiKeys = JSON.stringify([acmeAdmin.entry, acmeReader.entry, acmeAlpha.entry, globexAdmin.entry]);

let server: ReasoningServer;

beforeEach(async () => {
  server = await servingReasoning([], { API_KEYS: apiKeys });
  await server.call('POST', '/v1/orgs/acme/brains', { key: acmeAdmin.key, body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', '/v1/orgs/acme/brains', { key: acmeAdmin.key, body: { brain: 'beta', name: 'Beta' } });
});

afterEach(async () => {
  await server.stop();
});

function asKey<T>(
  key: string,
  use: (session: McpSession) => Promise<T>,
  kind: McpClientKind = 'current revision',
): Promise<T> {
  return withMcpSession(kind, { url: `${server.origin}/mcp`, headers: { authorization: `Bearer ${key}` } }, use);
}

describe('the org of a key on /mcp', () => {
  it('is the only one the key reaches, whatever brain or org the arguments name', async () => {
    const outcome = await asKey(globexAdmin.key, async (session) => ({
      listed: await session.callTool('list_brains', {}),
      read: await session.callTool('get_brain', { brain: 'alpha' }),
      specs: await session.callTool('list_specs', { brain: 'alpha', primitive: 'inference' }),
      named: await session.callTool('list_brains', { org: 'acme' }),
    }));

    expect(outcome.listed.structuredContent).toEqual({ brains: [] });
    expect(problemIn(outcome.read)).toMatchObject({ reason: 'not_found' });
    expect(problemIn(outcome.specs)).toMatchObject({
      reason: 'not_found',
      detail: 'There is no brain alpha in this org',
    });
    expect(problemIn(outcome.named)).toMatchObject({ reason: 'invalid_input', errors: [{ pointer: '/org' }] });
  });
});

describe('a key limited to one brain on /mcp', () => {
  it('lists only that brain and is refused every other with forbidden', async () => {
    const outcome = await asKey(acmeAlpha.key, async (session) => ({
      listed: await session.callTool('list_brains', {}),
      own: await session.callTool('list_specs', { brain: 'alpha', primitive: 'inference' }),
      other: await session.callTool('list_specs', { brain: 'beta', primitive: 'inference' }),
    }));

    expect(outcome.listed.structuredContent).toMatchObject({ brains: [{ id: 'alpha' }] });
    expect(outcome.own.structuredContent).toEqual({ specs: [] });
    expect(problemIn(outcome.other)).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller may not access this brain',
    });
  });
});

describe('a read-only key on /mcp', () => {
  it('is served its queries and refused its commands', async () => {
    const outcome = await asKey(acmeReader.key, async (session) => ({
      listed: await session.callTool('list_brains', {}),
      creating: await session.callTool('create_brain', { brain: 'gamma', name: 'Gamma' }),
      specs: await session.callTool('create_spec', { brain: 'alpha', primitive: 'inference', name: 'x', source: '' }),
    }));

    expect(outcome.listed.structuredContent).toMatchObject({ brains: [{ id: 'alpha' }, { id: 'beta' }] });
    expect(problemIn(outcome.creating)).toMatchObject({ detail: 'The caller lacks the org:write permission' });
    expect(problemIn(outcome.specs)).toMatchObject({ detail: 'The caller lacks the brain:write permission' });
  });
});

describe.each(mcpClientKinds)('the %s client on /mcp', (kind) => {
  it('lists the twenty tools and reads a brain of its org', async () => {
    const outcome = await asKey(
      acmeAdmin.key,
      async (session) => ({
        protocolVersion: session.protocolVersion,
        tools: toolNamesIn(await session.listTools()).length,
        brain: await session.callTool('get_brain', { brain: 'alpha' }),
      }),
      kind,
    );

    expect(outcome.tools).toBe(20);
    expect(outcome.brain.structuredContent).toMatchObject({ id: 'alpha' });
  });
});

async function toolsListedUnder(revision: string): Promise<readonly string[]> {
  const answer = await fetch(`${server.origin}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${acmeAdmin.key}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': revision,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const data = (await answer.text()).split('\n').filter((line) => line.startsWith('data: '));
  return data.flatMap((line) => toolNamesIn(listResultOf(line.slice('data: '.length)).result));
}

describe('the earlier revisions on /mcp', () => {
  it.each(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'])(
    'list the same tools under %s',
    async (revision) => {
      const current = await asKey(acmeAdmin.key, async (session) => toolNamesIn(await session.listTools()));

      expect(await toolsListedUnder(revision)).toEqual(current);
    },
  );
});
