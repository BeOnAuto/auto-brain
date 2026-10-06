import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { campaignPace, campaignRows } from '@beonauto/computation/testing';
import { answers, textResult } from '@beonauto/inference/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { servingReasoning } from '../testing/reasoning-server.ts';
import { spawnServer, spawnedServerTestTimeoutMs } from '../testing/spawned-server.ts';
import { executionIdIn, settledExecution, workflowSource } from '../testing/workflow-server.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onADatabaseOfItsOwn(): Promise<Readonly<Record<string, string>>> {
  const name = `server_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return { LOCAL_MODE: 'true', LEDGER_FILE: '', DATABASE_URL: database.href };
}

const brain = '/v1/orgs/acme/brains/alpha';

const computedRun = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.String, output: Schema.Json, record: Schema.Struct({ work: Schema.Number }) }),
);

async function computedOn(environment: Readonly<Record<string, string>>) {
  const computing = await servingReasoning([], environment);
  await computing.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await computing.call('POST', `${brain}/specs/computation`, { body: { name: 'pace', source: campaignPace } });
  await computing.call('POST', `${brain}/specs/computation/pace/execute`, {
    body: { input: campaignRows(500), execution_id: executionId },
  });
  const run = computedRun((await computing.call('GET', `${brain}/executions/${executionId}`)).body);
  await computing.stop();
  return run;
}

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

const approval = workflowSource(
  'approval',
  "do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.approved } } } }, output: { as: '${ .[0] }' } }\n",
);

describe.skipIf(skipped)(
  `A server that keeps its ledger in PostgreSQL${notice}`,
  { timeout: spawnedServerTestTimeoutMs },
  () => {
    it('executes a reasoning function definition of a brain it created, and reads the execution again after a restart', async () => {
      const environment = await onADatabaseOfItsOwn();
      const first = await servingReasoning([answers(textResult('Profits rose.'))], environment);
      const created = await first.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
      const spec = await first.call('POST', `${brain}/specs/inference`, { body: { name: 'summary', source: summary } });
      const executed = await first.call('POST', `${brain}/specs/inference/summary/execute`, {
        body: { input: { text: 'the quarter' }, execution_id: executionId },
      });
      const execution = `${brain}/executions/${executionId}`;
      const before = await first.call('GET', execution);
      await first.stop();

      const second = await servingReasoning([], environment);
      const after = await second.call('GET', execution);
      const brainAfter = await second.call('GET', brain);
      await second.stop();

      expect([created.status, spec.status, executed.status, before.status]).toEqual([201, 201, 200, 200]);
      expect(before.body).toMatchObject({ status: 'succeeded', output: 'Profits rose.', name: 'summary' });
      expect(after).toMatchObject({ status: 200, body: before.body });
      expect(brainAfter).toMatchObject({ status: 200, body: { id: 'alpha', name: 'Alpha', status: 'active' } });
    });

    it('says at start-up that the ledger is in PostgreSQL, with its database and host and never its URL', async () => {
      const environment = await onADatabaseOfItsOwn();
      const { host, pathname, password } = new URL(String(environment['DATABASE_URL']));
      const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', ...environment });
      await child.port;
      child.signal('SIGTERM');

      expect(await child.exited).toBe(0);
      expect(child.output().stderr).toContain(
        `"message":"The ledger is kept in PostgreSQL, in the database ${pathname.slice(1)} on ${host}"`,
      );
      expect(child.output().stderr).not.toContain(String(environment['DATABASE_URL']));
      expect(child.output().stderr).not.toContain(`:${password}@`);
    });
  },
);

describe.skipIf(skipped)(
  `Computation functions of a server that keeps its ledger in PostgreSQL${notice}`,
  { timeout: spawnedServerTestTimeoutMs },
  () => {
    it('runs a computation function to the same output, after the same work, as a server on SQLite', async () => {
      const onPostgresql = await computedOn(await onADatabaseOfItsOwn());
      const onSqlite = await computedOn({ LOCAL_MODE: 'true' });

      expect(onPostgresql).toEqual(onSqlite);
      expect(onPostgresql.status).toBe('succeeded');
    });
  },
);

describe.skipIf(skipped)(
  `Workflows of a server that keeps its ledger in PostgreSQL${notice}`,
  { timeout: spawnedServerTestTimeoutMs },
  () => {
    it('runs a workflow in the same database, and goes on with it after a restart', async () => {
      const environment = await onADatabaseOfItsOwn();
      const first = await servingReasoning([], environment);
      await first.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
      await first.call('POST', `${brain}/specs/orchestration`, { body: { name: 'approval', source: approval } });
      const started = await first.call('POST', `${brain}/specs/orchestration/approval/execute`, {
        body: { input: {} },
      });
      await first.stop();

      const second = await servingReasoning([], environment);
      const execution = `${brain}/executions/${executionIdIn(started.body)}`;
      const sent = await second.call('POST', `${execution}/events`, {
        body: { event: { type: 'com.acme.approved', data: { by: 'Ada' } } },
      });
      const settled = await settledExecution(second, execution);
      await second.stop();

      expect(started).toMatchObject({ status: 200, body: { status: 'started' } });
      expect(sent.status).toBe(200);
      expect(settled).toMatchObject({ body: { status: 'succeeded', output: { by: 'Ada' } } });
    });
  },
);
