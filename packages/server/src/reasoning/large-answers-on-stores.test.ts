import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import { toolBounds } from '@beonauto/mcp';
import { serveFakeMcp } from '@beonauto/mcp/testing';
import { answers, callingTools, textResult } from '@beonauto/reasoning/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const postgresqlNotice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const calls = toolBounds.callsInRun;

const kibibytesOf = (call: number): number => 1000 + call;

const reading = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/large]', '---', 'Read it all.'].join('\n');

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
  const name = `large_answers_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return { LEDGER_FILE: '', DATABASE_URL: database.href };
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly environment: () => Promise<Readonly<Record<string, string>>>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, environment: () => Promise.resolve({}) },
  { store: `PostgreSQL${postgresqlNotice}`, skipped: postgresql === '', environment: onADatabaseOfItsOwn },
];

const decodeIds = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String })) }),
);

const decodeAnswered = Schema.decodeUnknownSync(
  Schema.Struct({ data: Schema.Struct({ result_bytes: Schema.Int, answer: Schema.String }) }),
);

async function servingLargeAnswers(environment: Readonly<Record<string, string>>): Promise<ReasoningServer> {
  const graph = await serveFakeMcp();
  onTestFinished(graph.close);
  const everyCall = Array.from(
    { length: calls },
    (_, call) => ['mcp__graph__large', { kib: kibibytesOf(call) }] as const,
  );
  const server = await servingReasoning([callingTools(everyCall, answers(textResult('Read them all.')))], {
    LOCAL_MODE: 'true',
    MCP_SERVERS: JSON.stringify({ graph: { url: graph.url, org: 'acme' } }),
    ...environment,
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'reading', source: reading } });
  return server;
}

interface ReadBack {
  readonly kibibytes: number;
  readonly whole: boolean;
}

async function answersReadBack(server: ReasoningServer): Promise<readonly ReadBack[]> {
  const history = await server.call('GET', `${alpha}/runs/${runId}/history?limit=100`);
  const answered = decodeIds(history.body).events.filter(({ type }) => type === 'tool_call_answered');
  return Promise.all(
    answered.map(async ({ id }) => {
      const { data } = decodeAnswered((await server.call('GET', `${alpha}/events/${id}`)).body);
      const answerBytes = Buffer.byteLength(data.answer, 'utf8');
      return { kibibytes: answerBytes / 1024, whole: data.result_bytes > answerBytes };
    }),
  );
}

describe.each(stores)('a reasoning run whose every call answers 1 MB, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)(
    'keeps each answer whole and reads every one back within the deadline of the run',
    { timeout: toolBounds.runMs },
    async () => {
      const server = await servingLargeAnswers(await environment());
      const started = performance.now();

      const ran = await server.call('POST', `${alpha}/definitions/reasoning/reading/run`, {
        body: { input: {}, run_id: runId },
      });
      const readBack = await answersReadBack(server);
      const took = performance.now() - started;

      expect(ran.body).toMatchObject({ status: 'succeeded', output: 'Read them all.' });
      expect(readBack).toEqual(
        Array.from({ length: calls }, (_, call) => ({ kibibytes: kibibytesOf(call), whole: true })),
      );
      expect(took).toBeLessThan(toolBounds.runMs);
    },
  );
});
