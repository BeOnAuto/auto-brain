import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { messageIdOf } from '@beonauto/operations';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import { collecting, foldedAll, isLive, viewTestTimeoutMs } from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';
import { viewsSuites } from '../views-testing/views-suites.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function administered(statement: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function aDatabase(): Promise<string> {
  const name = `workflow_host_${randomUUID().replaceAll('-', '')}`;
  await administered(`CREATE DATABASE ${name}`);
  await administered(`ALTER DATABASE ${name} SET synchronous_commit = off`);
  onTestFinished(async () => {
    await administered(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

const onPostgreSQL: SettingsOf = async () => ({ store: 'postgresql', connectionString: await aDatabase() });

async function aRunLeftOpen(connectionString: string, output: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  onTestFinished(() => client.end());
  const stream = `brain/acme/alpha/executions/${randomUUID()}`;
  const definition = {
    primitive: 'inference',
    name: 'late',
    spec_version: 1,
    by: 'acme-admin',
    at: '2026-10-06T10:00:00.000Z',
  };
  const event = { type: 'execution_succeeded', ...definition, output, record: {} };
  const metadata = { messageId: messageIdOf(stream, 1), causationId: null, correlationId: null };
  await client.query('BEGIN');
  await client.query(
    `SELECT success FROM emt_append_to_stream(
      ARRAY[$4], ARRAY[$1::jsonb], ARRAY[$5::jsonb], ARRAY['1'], ARRAY['execution_succeeded'], ARRAY['E'], $2, 'brain', $3, 'emt:default')`,
    [{ json: JSON.stringify(event) }, stream, 0, metadata.messageId, metadata],
  );
  return client;
}

describe.skipIf(skipped)(`the views of recall functions on PostgreSQL${notice}`, () => {
  viewsSuites(onPostgreSQL);

  describe('an event committed late', { timeout: viewTestTimeoutMs }, () => {
    it('is folded once it is committed, in the order the ledger recorded it, never passed over', async () => {
      const connectionString = await aDatabase();
      const views = await viewHarness({ store: 'postgresql', connectionString });
      await views.saved('outputs', collecting);
      views.start();
      await views.until('outputs', isLive);
      const open = await aRunLeftOpen(connectionString, 'late');

      await views.ran('inference/after', 'after');
      await setTimeout(500);
      const held = await views.viewOf('outputs');
      await open.query('COMMIT');
      const folded = await views.until('outputs', foldedAll(2));

      expect([held?.view, folded.view]).toEqual([[], ['late', 'after']]);
    });
  });
});
