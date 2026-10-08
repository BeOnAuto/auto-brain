import { randomUUID } from 'node:crypto';

import { withMcpSession } from '@beonauto/api/testing';
import { Effect, Schema } from 'effect';
import { Client } from 'pg';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const postgresqlNotice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onADatabaseOfItsOwn(): Promise<Readonly<Record<string, string>>> {
  const name = `definition_runs_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return { LOCAL_MODE: 'true', LEDGER_FILE: '', DATABASE_URL: database.href };
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly environment: () => Promise<Readonly<Record<string, string>>>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, environment: () => Promise.resolve({ LOCAL_MODE: 'true' }) },
  { store: `PostgreSQL${postgresqlNotice}`, skipped: postgresql === '', environment: onADatabaseOfItsOwn },
];

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

const echoed = ['---', 'language: jq', '---', '.'].join('\n');

const RunsPageSchema = Schema.Struct({
  executions: Schema.Array(Schema.Struct({ execution_id: Schema.String, primitive: Schema.String })),
  has_more: Schema.Boolean,
  next_cursor: Schema.NullOr(Schema.String),
});

type RunsPage = typeof RunsPageSchema.Type;

const runsPageOf = Schema.decodeUnknownSync(RunsPageSchema);

function runOf(index: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-${String(index).padStart(12, '0')}`;
}

const reasoningRuns = [1, 2, 3].map((index) => runOf(index));

const newerComputationRuns = [4, 5, 6, 7, 8].map((index) => runOf(index));

let server: ReasoningServer;

function inTurn(executionIds: readonly string[], started: (executionId: string) => Promise<unknown>): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(executionIds, (executionId) => Effect.promise(() => started(executionId)), { discard: true }),
  );
}

afterEach(async () => {
  await server.stop();
});

async function threeReasoningRunsBehindFiveComputationRuns(environment: Readonly<Record<string, string>>) {
  server = await servingReasoning([], environment);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/specs/computation`, { body: { name: 'echoed', source: echoed } });
  await inTurn(reasoningRuns, (executionId) =>
    server.call('POST', `${alpha}/specs/inference/summary/execute`, {
      body: { input: { text: 7 }, execution_id: executionId },
    }),
  );
  await inTurn(newerComputationRuns, (executionId) =>
    server.call('POST', `${alpha}/specs/computation/echoed/execute`, {
      body: { input: {}, execution_id: executionId },
    }),
  );
}

function figuresOf({ executions, has_more: hasMore }: RunsPage): readonly [readonly string[], boolean] {
  return [executions.map(({ execution_id: id }) => id), hasMore];
}

async function overHttp(cursor?: string): Promise<RunsPage> {
  const next = cursor === undefined ? '' : `&cursor=${cursor}`;
  const { body } = await server.call('GET', `${alpha}/executions?primitive=inference&limit=2${next}`);
  return runsPageOf(body);
}

function overMcp(): Promise<readonly RunsPage[]> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} },
    async (session) => {
      const first = await session.callTool('list_executions', { primitive: 'inference', limit: 2 });
      const firstPage = runsPageOf(first.structuredContent);
      const next = await session.callTool('list_executions', {
        primitive: 'inference',
        limit: 2,
        cursor: String(firstPage.next_cursor),
      });
      return [firstPage, runsPageOf(next.structuredContent)];
    },
  );
}

describe.each(stores)('the runs of one primitive, a page at a time, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)(
    'fill each page with as many of its runs as the limit asks, behind newer runs of another, over HTTP and MCP',
    { timeout: 60_000 },
    async () => {
      await threeReasoningRunsBehindFiveComputationRuns(await environment());

      const first = await overHttp();
      const pagesOverHttp = [first, await overHttp(String(first.next_cursor))];
      const pagesOverMcp = await overMcp();

      const expected = [
        [[runOf(3), runOf(2)], true],
        [[runOf(1)], false],
      ];
      expect(pagesOverHttp.map((page) => figuresOf(page))).toEqual(expected);
      expect(pagesOverMcp.map((page) => figuresOf(page))).toEqual(expected);
      expect(pagesOverHttp.flatMap(({ executions }) => executions.map(({ primitive }) => primitive))).toEqual([
        'inference',
        'inference',
        'inference',
      ]);
    },
  );
});
