import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { testGuides, testRecipes } from '../testing/guides.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { withMcpSession } from '../testing/mcp-clients.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { operationsIn, schemaErrorsIn } from '../testing/openapi-document.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';

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

const everyGuide = [...testGuides, ...testRecipes];

const ContentsSchema = Schema.Struct({ contents: Schema.Array(Schema.Struct({ text: Schema.String })) });

const SchemasSchema = Schema.Struct({
  components: Schema.Struct({ schemas: Schema.Struct({ problem: Schema.Record(Schema.String, Schema.Unknown) }) }),
});

function resourceTexts(): Promise<readonly string[]> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    (session) =>
      Promise.all(
        everyGuide.map(async ({ name }) => {
          const { contents } = Schema.decodeUnknownSync(ContentsSchema)(await session.readResource(`guide://${name}`));
          return contents.map(({ text }) => text).join('');
        }),
      ),
  );
}

describe('the OpenAPI document', () => {
  it('is answered at /v1/openapi.json without a key, as JSON that no cache keeps, the same bytes each time', async () => {
    const [first, second] = [
      await call(server.handler, '/v1/openapi.json'),
      await call(server.handler, '/v1/openapi.json'),
    ];

    expect(first).toMatchObject({ status: 200, body: { openapi: '3.1.1', info: { title: 'Auto Runtime' } } });
    expect(operationsIn(first.body)).toHaveLength(notebookOperations.length + 1);
    expect(first.headers.get('content-type')).toBe('application/json');
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(second.text).toBe(first.text);
  });

  it('is answered from any origin, and to no method but GET', async () => {
    const [foreign, posted] = await Promise.all([
      call(server.handler, '/v1/openapi.json', { headers: { origin: 'https://elsewhere.example' } }),
      call(server.handler, '/v1/openapi.json', { method: 'POST' }),
    ]);

    expect([foreign.status, posted.status, posted.headers.get('allow')]).toEqual([200, 405, 'GET, HEAD']);
  });
});

interface Markdown {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

async function guideOverHttp(name: string): Promise<Markdown> {
  const response = await server.handler.fetch(new Request(`http://localhost/v1/guides/${name}`));
  return { status: response.status, headers: response.headers, text: await response.text() };
}

describe('a guide over HTTP', () => {
  it('is answered without a key as Markdown no cache keeps, the very text the MCP resource of its name reads', async () => {
    const answers = await Promise.all(everyGuide.map(({ name }) => guideOverHttp(name)));

    expect(answers.map(({ status, text }) => ({ status, text }))).toEqual(
      (await resourceTexts()).map((text) => ({ status: 200, text })),
    );
    expect(answers.map(({ headers }) => [headers.get('content-type'), headers.get('cache-control')])).toEqual(
      everyGuide.map(() => ['text/markdown; charset=utf-8', 'no-store']),
    );
  });

  it('is a not_found problem document for a name the shelf does not hold', async () => {
    const answer = await call(server.handler, '/v1/guides/cooking');

    expect(answer).toMatchObject({
      status: 404,
      body: { reason: 'not_found', detail: 'The server holds no guide of that name' },
    });
    expect(answer.headers.get('content-type')).toBe('application/problem+json');
  });

  it("is refused with a problem the document's schema of a problem accepts", async () => {
    const [refused, described] = await Promise.all([
      call(server.handler, '/v1/guides/cooking'),
      call(server.handler, '/v1/openapi.json'),
    ]);
    const { problem } = Schema.decodeUnknownSync(SchemasSchema)(described.body).components.schemas;

    expect(schemaErrorsIn(problem, refused.body)).toEqual([]);
    expect(schemaErrorsIn(problem, { reason: 'lost' })).toContain("data must have required property 'type'");
  });
});

describe('the paths without a key', () => {
  it('are the document and the guides alone, so an operation still wants one', async () => {
    const [operation, beyond] = await Promise.all([
      call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes'),
      call(server.handler, '/v1/openapi.json/notes'),
    ]);

    expect([operation.status, beyond.status]).toEqual([401, 401]);
  });
});
