import { calledOpeningLinks, toolNamesIn, withMcpSession, type LinkOpening } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoning([]);
});

afterAll(async () => {
  await server.stop();
});

const notes = { kind: 'mcp', entry: { url: 'https://notes.example.com/mcp' }, credential: { kind: 'none' } };

const AddedSchema = Schema.Struct({ connect: Schema.Struct({ url: Schema.String }) });

function adding(name: string, opening: Partial<LinkOpening> = {}) {
  const connection = { url: `${server.origin}/mcp`, headers: {} };
  return calledOpeningLinks(connection, { name: 'add_connection', arguments: { ...notes, name } }, opening);
}

function toolsOn(path: string): Promise<readonly string[]> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, async (session) =>
    toolNamesIn(await session.listTools()),
  );
}

const connectionTools = ['add_connection', 'list_connections', 'remove_connection'];

describe('the tools of connections', () => {
  it('are three operations on /mcp and on the org endpoint, and neither get_connection nor any of the three of the link', async () => {
    const [own, org] = [await toolsOn('/mcp'), await toolsOn('/orgs/local/mcp')];

    expect([own, org].map((names) => names.filter((name) => name.includes('connection')))).toEqual([
      connectionTools,
      connectionTools,
    ]);
    expect(
      [...own, ...org].filter((name) => ['get_connection', 'read_link', 'approve', 'give_credential'].includes(name)),
    ).toEqual([]);
  });
});

describe('add_connection over MCP', () => {
  it('asks a client that opens links to open the page of the link, saying what to do, and puts the link in its answer', async () => {
    const { answer, elicited } = await adding('notes-linked');

    const { url } = Schema.decodeUnknownSync(AddedSchema)(answer.structuredContent).connect;
    expect(elicited).toEqual([
      {
        mode: 'url',
        message:
          'Open this page to approve the connection “notes-linked”, and give its credential where it takes one, within ten minutes.',
        url,
      },
    ]);
    expect(url).toMatch(/^https:\/\/studio\.on\.auto\/connect\?server=http%3A%2F%2F127\.0\.0\.1%3A\d+&org=local&/u);
  });

  it('asks nothing of a client that does not declare it opens links, or speaks 2025-11-25, and answers the link', async () => {
    const formsAlone = await adding('notes-forms', { opens: 'forms alone' });
    const legacy = await adding('notes-legacy', { revision: 'previous revision' });

    const urls = [formsAlone, legacy].map(
      ({ answer }) => Schema.decodeUnknownSync(AddedSchema)(answer.structuredContent).connect.url,
    );
    expect([formsAlone.elicited, legacy.elicited]).toEqual([[], []]);
    expect(urls.filter((url) => url.startsWith('https://studio.on.auto/connect?server='))).toHaveLength(2);
  });
});
