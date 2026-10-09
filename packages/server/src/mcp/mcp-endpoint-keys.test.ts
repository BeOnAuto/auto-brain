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

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const listResultOf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ result: Schema.Unknown })));

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' });

const acmeReader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'brain:read'],
  brains: '*',
});

const acmeAlpha = createApiKey({ id: 'acme-alpha', org: 'acme', permissions: allPermissions, brains: ['alpha'] });

const acmeBrainReader = createApiKey({
  id: 'acme-brain-reader',
  org: 'acme',
  permissions: ['brain:read'],
  brains: '*',
});

const queriesInsideABrain = [
  'list_definitions',
  'get_definition',
  'get_run',
  'list_runs',
  'get_run_history',
  'get_brain_analytics',
  'list_brain_events',
  'list_interactions',
];

const commands = [
  'create_brain',
  'update_brain',
  'retire_brain',
  'create_definition',
  'update_definition',
  'retire_definition',
  'run_definition',
  'cancel_run',
  'publish_event',
  'test_tool_call',
  'answer_interaction',
  'send_run_event',
];

const globexAdmin = createApiKey({ id: 'globex-admin', org: 'globex', permissions: allPermissions, brains: '*' });

const apiKeys = JSON.stringify([
  acmeAdmin.entry,
  acmeReader.entry,
  acmeAlpha.entry,
  acmeBrainReader.entry,
  globexAdmin.entry,
]);

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
      definitions: await session.callTool('list_definitions', { brain: 'alpha', type: 'reasoning' }),
      named: await session.callTool('list_brains', { org: 'acme' }),
    }));

    expect(outcome.listed.structuredContent).toEqual({ brains: [] });
    expect(problemIn(outcome.read)).toMatchObject({ reason: 'not_found' });
    expect(problemIn(outcome.definitions)).toMatchObject({
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
      own: await session.callTool('list_definitions', { brain: 'alpha', type: 'reasoning' }),
      other: await session.callTool('list_definitions', { brain: 'beta', type: 'reasoning' }),
    }));

    expect(outcome.listed.structuredContent).toMatchObject({ brains: [{ id: 'alpha' }] });
    expect(outcome.own.structuredContent).toEqual({ definitions: [] });
    expect(problemIn(outcome.other)).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller may not access this brain',
    });
  });
});

describe('the tool servers on /mcp, for a key limited to one brain', () => {
  it('are those of its brain, and those of the whole org are refused it with words that say to name its brain', async () => {
    const outcome = await asKey(acmeAlpha.key, async (session) => ({
      own: await session.callTool('list_tool_servers', { brain: 'alpha' }),
      org: await session.callTool('list_tool_servers', {}),
    }));

    expect(outcome.own.structuredContent).toEqual({ tool_servers: [] });
    expect(problemIn(outcome.org)).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller may access only some brains of this org; name one of them in brain',
    });
  });
});

describe('a read-only key on /mcp', () => {
  it('is served its queries and offered no command', async () => {
    const outcome = await asKey(acmeReader.key, async (session) => ({
      tools: toolNamesIn(await session.listTools()),
      listed: await session.callTool('list_brains', {}),
    }));

    expect(outcome.tools).toEqual([
      'list_brains',
      'get_brain',
      'list_models',
      'list_tool_servers',
      ...queriesInsideABrain,
      'get_guide',
    ]);
    expect(outcome.listed.structuredContent).toMatchObject({ brains: [{ id: 'alpha' }, { id: 'beta' }] });
  });

  it('answers a command it is not offered as a tool the endpoint does not list', async () => {
    await expect(
      asKey(acmeReader.key, (session) => session.callTool('create_brain', { brain: 'gamma', name: 'Gamma' })),
    ).rejects.toThrow('Tool create_brain not found');
  });
});

describe('a key that may only read inside brains, on /mcp', () => {
  it('lists the brains it may read, the queries inside a brain and no command, and its instructions name no command', async () => {
    const outcome = await asKey(acmeBrainReader.key, async (session) => ({
      tools: toolNamesIn(await session.listTools()),
      instructions: String(session.instructions),
      listed: await session.callTool('list_brains', {}),
    }));

    expect(outcome.tools).toEqual(['list_brains', 'list_tool_servers', ...queriesInsideABrain, 'get_guide']);
    expect(commands.filter((name) => outcome.instructions.includes(name))).toEqual([]);
    expect(outcome.instructions).toContain(
      "This connection acts in the caller's own org: list_brains shows its brains. The tools call a definition",
    );
    expect(outcome.listed.structuredContent).toMatchObject({ brains: [{ id: 'alpha' }, { id: 'beta' }] });
  });
});

describe.each(mcpClientKinds)('the %s client on /mcp', (kind) => {
  it('lists the twenty-five tools and reads a brain of its org', async () => {
    const outcome = await asKey(
      acmeAdmin.key,
      async (session) => ({
        protocolVersion: session.protocolVersion,
        tools: toolNamesIn(await session.listTools()).length,
        brain: await session.callTool('get_brain', { brain: 'alpha' }),
      }),
      kind,
    );

    expect(outcome.tools).toBe(25);
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
