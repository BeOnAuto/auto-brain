import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/reasoning-server.ts';
import { settledExecution, workflowSource, workflowTestTimeoutMs } from '../testing/workflow-server.ts';

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
  const name = `nesting_${randomUUID().replaceAll('-', '')}`;
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

const waiting = workflowSource(
  'waiting',
  `do:
  - decide:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided }
        read: envelope
`,
);

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function nested(levels: number): unknown {
  return levels === 0 ? 'yes' : [nested(levels - 1)];
}

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function brainWithAWaitingWorkflow(environment: Readonly<Record<string, string>>): Promise<void> {
  server = await servingReasoning([], environment);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'waiting', source: waiting } });
}

describe.each(stores)(
  'values nested as deep as a run holds them, over HTTP, on $store',
  { timeout: workflowTestTimeoutMs },
  ({ skipped, environment }) => {
    it.skipIf(skipped)('are taken as a run input, as the data of a sent event and of a published one', async () => {
      await brainWithAWaitingWorkflow(await environment());

      const started = await server.call('POST', `${alpha}/specs/orchestration/waiting/execute`, {
        body: { input: nested(512), execution_id: executionId },
      });
      const sent = await server.call('POST', `${alpha}/executions/${executionId}/events`, {
        body: { event: { type: 'com.acme.approval.decided', data: nested(510) } },
      });
      const published = await server.call('POST', `${alpha}/events`, {
        body: { event: { source: '/ledger/eu', type: 'com.acme.ledger.month-closed', data: nested(510) } },
      });

      expect([started.status, sent.status, published.status]).toEqual([200, 200, 200]);
      expect(await settledExecution(server, `${alpha}/executions/${executionId}`)).toMatchObject({
        body: { status: 'succeeded' },
      });
    });

    it.skipIf(skipped)('are refused deeper than that, as invalid input, before anything is recorded', async () => {
      await brainWithAWaitingWorkflow(await environment());

      const executed = await server.call('POST', `${alpha}/specs/orchestration/waiting/execute`, {
        body: { input: nested(3000) },
      });
      const sent = await server.call('POST', `${alpha}/executions/${executionId}/events`, {
        body: { event: { type: 'com.acme.approval.decided', data: nested(3000) } },
      });
      const published = await server.call('POST', `${alpha}/events`, {
        body: { event: { source: '/ledger/eu', type: 'com.acme.ledger.month-closed', data: nested(3000) } },
      });

      expect([executed, sent, published].map(({ status, body }) => [status, body])).toMatchObject([
        [422, { reason: 'invalid_input', errors: [{ pointer: '/input' }] }],
        [422, { reason: 'invalid_input', errors: [{ pointer: '/event/data' }] }],
        [422, { reason: 'invalid_input', errors: [{ pointer: '/event/data' }] }],
      ]);
      expect(await server.call('GET', `${alpha}/executions`)).toMatchObject({ body: { executions: [] } });
    });
  },
);
