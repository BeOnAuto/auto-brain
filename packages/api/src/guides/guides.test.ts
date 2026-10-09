import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testGuides, testRecipes } from '../testing/guides.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import {
  mcpClientKinds,
  plainTextIn,
  problemIn,
  textOf,
  withMcpSession,
  type McpSession,
} from '../testing/mcp-clients.ts';
import { acmeAdmin, acmeReader, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { guideToolName, listedTools } from '../testing/tool-listing.ts';

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

const endpoints = ['/mcp', '/orgs/acme/mcp', '/orgs/acme/brains/alpha/mcp'];

const everyGuide = [...testGuides, ...testRecipes];

const ResourcesSchema = Schema.Struct({
  resources: Schema.Array(
    Schema.Struct({
      uri: Schema.String,
      name: Schema.String,
      title: Schema.String,
      description: Schema.String,
      mimeType: Schema.String,
      annotations: Schema.Struct({ audience: Schema.Array(Schema.String) }),
    }),
  ),
});

const ContentsSchema = Schema.Struct({
  contents: Schema.Array(Schema.Struct({ uri: Schema.String, mimeType: Schema.String, text: Schema.String })),
});

function on<T>(path: string, use: (session: McpSession) => Promise<T>, key = acmeAdmin.key): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${key}` } },
    use,
  );
}

describe('the guide tool', () => {
  it.each(endpoints)(
    'is listed on %s, read-only, with the names of the guides as the values of its argument',
    async (path) => {
      const tools = listedTools(await on(path, (session) => session.listTools()));
      const guideTool = tools.find(({ name }) => name === guideToolName);

      expect(guideTool).toMatchObject({
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: { guide: { type: 'string', enum: everyGuide.map(({ name }) => name) } },
          required: ['guide'],
          additionalProperties: false,
        },
      });
    },
  );
});

describe('the guide tool, for any key', () => {
  it('is offered to a key that may only read', async () => {
    const tools = listedTools(await on('/mcp', (session) => session.listTools(), acmeReader.key));

    expect(tools.map(({ name }) => name)).toContain(guideToolName);
  });

  it('answers the whole text of each guide, and nothing else', async () => {
    const answers = await on('/mcp', (session) =>
      Promise.all(everyGuide.map(({ name }) => session.callTool(guideToolName, { guide: name }))),
    );

    expect(
      answers.map((answer) => ({ isError: answer.isError, text: textOf(answer), content: answer.content.length })),
    ).toEqual(everyGuide.map(({ text }) => ({ isError: undefined, text, content: 1 })));
  });

  it('refuses a guide it does not carry, a guide that is not named and an argument it does not take, as invalid input', async () => {
    const [unknown, unnamed, extra] = await on('/mcp', (session) =>
      Promise.all([
        session.callTool(guideToolName, { guide: 'cooking' }),
        session.callTool(guideToolName, {}),
        session.callTool(guideToolName, { guide: 'notebook', page: 2 }),
      ]),
    );

    expect(problemIn(unknown)).toMatchObject({
      reason: 'invalid_input',
      errors: [{ detail: 'There is no guide cooking', pointer: '/guide' }],
    });
    expect(plainTextIn(unknown)).toBe(
      'Could not read the guide: what was given does not fit what it needs. This can be corrected and tried again; the details below say what to change.',
    );
    expect(problemIn(unnamed)).toMatchObject({ reason: 'invalid_input', errors: [{ pointer: '/guide' }] });
    expect(problemIn(extra)).toMatchObject({ reason: 'invalid_input', errors: [{ pointer: '/page' }] });
  });
});

describe.each(mcpClientKinds)('the guides as resources, for the %s client', (kind) => {
  it('are listed as the same guides, in Markdown, for the assistant, and read as the same text', async () => {
    const outcome = await withMcpSession(
      kind,
      { url: `${listening.origin}/orgs/acme/brains/alpha/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
      async (session) => ({
        listed: Schema.decodeUnknownSync(ResourcesSchema)(await session.listResources()),
        read: await Promise.all(
          everyGuide.map(async ({ name }) =>
            Schema.decodeUnknownSync(ContentsSchema)(await session.readResource(`guide://${name}`)),
          ),
        ),
      }),
    );

    expect(outcome.listed.resources).toEqual(
      everyGuide.map(({ name, title, description }) => ({
        uri: `guide://${name}`,
        name,
        title,
        description,
        mimeType: 'text/markdown',
        annotations: { audience: ['assistant'] },
      })),
    );
    expect(outcome.read).toEqual(
      everyGuide.map(({ name, text }) => ({ contents: [{ uri: `guide://${name}`, mimeType: 'text/markdown', text }] })),
    );
  });
});
