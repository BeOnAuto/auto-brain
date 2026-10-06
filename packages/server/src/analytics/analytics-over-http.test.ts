import { randomUUID } from 'node:crypto';

import { withMcpSession } from '@beonauto/api/testing';
import { OutputInvalid } from '@beonauto/inference';
import { answers, textResult } from '@beonauto/inference/testing';
import { Effect, Schema } from 'effect';
import { Client } from 'pg';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/reasoning-server.ts';

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
  const name = `analytics_${randomUUID().replaceAll('-', '')}`;
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

function usageOf(input: number, cached: number, output: number) {
  return {
    input: { total: input, uncached: input - cached, cache_read: cached, cache_write: 0 },
    output: { total: output, text: output, reasoning: null },
    total: input + output,
  };
}

const unusable = new OutputInvalid({
  detail: 'The answer is not JSON',
  provider: 'anthropic',
  finish_reason: 'stop',
  raw_finish_reason: 'end_turn',
  usage: usageOf(300, 0, 20),
  issues: [],
});

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function brainWithThreeRuns(environment: Readonly<Record<string, string>>): Promise<void> {
  server = await servingReasoning(
    [answers(textResult('Profits rose.', { usage: usageOf(1200, 1000, 80) })), () => Effect.fail(unusable)],
    environment,
  );
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'summary', source: summary } });
  const running = (input: Readonly<Record<string, unknown>>) =>
    server.call('POST', `${alpha}/specs/inference/summary/execute`, { body: { input } });
  await running({ text: 'the quarter' });
  await running({ text: 'the year' });
  await running({ text: 7 });
}

const today = new Date().toISOString().slice(0, 10);

const decodeDuration = Schema.decodeUnknownSync(
  Schema.Struct({ duration_ms: Schema.Struct({ p50: Schema.Int, p95: Schema.Int }) }),
);

function durationOf(body: unknown): { readonly p50: number; readonly p95: number } {
  return decodeDuration(body).duration_ms;
}

describe.each(stores)('the analytics of a brain over HTTP and MCP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)(
    'count the runs that ended today, by how they ended, and the tokens their models used',
    async () => {
      await brainWithThreeRuns(await environment());

      const read = await server.call('GET', `${alpha}/analytics`);
      const filtered = await server.call('GET', `${alpha}/analytics?days=14&primitive=inference&name=summary`);
      const onAlpha = { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} };
      const overMcp = await withMcpSession('current revision', onAlpha, (session) =>
        session.callTool('get_brain_analytics', {}),
      );

      expect(read).toMatchObject({
        status: 200,
        body: {
          days: 7,
          runs: { total: 3, succeeded: 1, failed: 0, rejected: 2 },
          tokens: { input: 1500, output: 100, cached: 1000 },
          by_function: [{ primitive: 'inference', name: 'summary', runs: 3 }],
        },
      });
      expect(read.body).toMatchObject({ by_day: { 6: { day: today, runs: { total: 3 } } } });
      expect(durationOf(read.body).p50).toBeLessThanOrEqual(durationOf(read.body).p95);
      expect(filtered).toMatchObject({ status: 200, body: { days: 14, runs: { total: 3 } } });
      expect(overMcp.structuredContent).toEqual(read.body);
    },
  );

  it.skipIf(skipped)('answer a retired brain, and refuse a brain that is not there', async () => {
    await brainWithThreeRuns(await environment());
    await server.call('POST', '/v1/orgs/acme/brains/alpha/retire');

    const retired = await server.call('GET', `${alpha}/analytics?days=30`);
    const missing = await server.call('GET', '/v1/orgs/acme/brains/zeta/analytics');

    expect(retired).toMatchObject({ status: 200, body: { days: 30, runs: { total: 3 } } });
    expect(missing).toMatchObject({ status: 404, body: { reason: 'not_found' } });
  });
});

describe('the analytics of a brain over HTTP, asked for what they cannot answer', () => {
  it('are refused as invalid input, pointing at what is wrong', async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });

    const refusals = await Promise.all(
      [
        'days=8',
        'days=7&from=2026-10-01',
        'from=2026-02-30&to=2026-03-01',
        'from=2026-10-01',
        'from=2026-10-01&to=9999-12-31',
        'limit=1',
      ].map((query) => server.call('GET', `${alpha}/analytics?${query}`)),
    );
    const since = await server.call('GET', `${alpha}/events?since=2026-02-30T00:00:00Z`);

    expect([...refusals, since].map(({ status, body }) => [status, body])).toMatchObject([
      [422, { reason: 'invalid_input', errors: [{ pointer: '/days' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/days' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/from' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/to' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/to' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/limit' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/since' }] }],
    ]);
  });
});
