import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { campaignPace, campaignRows } from '@beonauto/computation/testing';
import { answers, textResult } from '@beonauto/reasoning/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { spawnServer, spawnedServerTestTimeoutMs } from '../testing/processes/spawned-server.ts';
import { servingReasoning } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

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
  await computing.call('POST', `${brain}/definitions/computation`, { body: { name: 'pace', source: campaignPace } });
  const runs = await runIds.reduce<Promise<readonly ReturnType<typeof computedRun>[]>>(async (before, runId) => {
    await computing.call('POST', `${brain}/definitions/computation/pace/run`, {
      body: { input: campaignRows(500), run_id: runId },
    });
    const run = computedRun((await computing.call('GET', `${brain}/runs/${runId}`)).body);
    return [...(await before), run];
  }, Promise.resolve([]));
  await computing.stop();
  return runs;
}

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const runIds = [runId, '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b'];

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
  "do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.approved } } } }, output: { as: '${ $data[0] }' } }\n",
);

describe.skipIf(skipped)(
  `A server that keeps its ledger in PostgreSQL${notice}`,
  { timeout: spawnedServerTestTimeoutMs },
  () => {
    it('executes a reasoning function definition of a brain it created, and reads the run again after a restart', async () => {
      const environment = await onADatabaseOfItsOwn();
      const first = await servingReasoning([answers(textResult('Profits rose.'))], environment);
      const created = await first.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
      const definition = await first.call('POST', `${brain}/definitions/reasoning`, {
        body: { name: 'summary', source: summary },
      });
      const ran = await first.call('POST', `${brain}/definitions/reasoning/summary/run`, {
        body: { input: { text: 'the quarter' }, run_id: runId },
      });
      const run = `${brain}/runs/${runId}`;
      const before = await first.call('GET', run);
      await first.stop();

      const second = await servingReasoning([], environment);
      const after = await second.call('GET', run);
      const brainAfter = await second.call('GET', brain);
      await second.stop();

      expect([created.status, definition.status, ran.status, before.status]).toEqual([201, 201, 200, 200]);
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
    it('runs a computation function to the same output, after the same work, as a server on SQLite, in a cold worker and then a warm one', async () => {
      const onPostgresql = await computedOn(await onADatabaseOfItsOwn());
      const onSqlite = await computedOn({ LOCAL_MODE: 'true' });

      const [cold, warm] = onPostgresql;

      expect(onPostgresql).toEqual(onSqlite);
      expect(warm).toEqual(cold);
      expect(cold?.status).toBe('succeeded');
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
      await first.call('POST', `${brain}/definitions/workflow`, { body: { name: 'approval', source: approval } });
      const started = await first.call('POST', `${brain}/definitions/workflow/approval/run`, {
        body: { input: {} },
      });
      await first.stop();

      const second = await servingReasoning([], environment);
      const run = `${brain}/runs/${runIdIn(started.body)}`;
      const sent = await second.call('POST', `${run}/events`, {
        body: { event: { type: 'com.acme.approved', data: { by: 'Ada' } } },
      });
      const settled = await settledRun(second, run);
      await second.stop();

      expect(started).toMatchObject({ status: 200, body: { status: 'started' } });
      expect(sent.status).toBe(200);
      expect(settled).toMatchObject({ body: { status: 'succeeded', output: { by: 'Ada' } } });
    });
  },
);
