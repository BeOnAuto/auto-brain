import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { describe, onTestFinished } from 'vitest';

import { failureSuite } from '../testing/failure-suite.ts';
import type { SettingsOf } from '../testing/host-files.ts';
import { claimSuite, leaseSuite } from '../testing/lease-suite.ts';
import { longRunSuite } from '../testing/long-run-suite.ts';
import { portSuite } from '../testing/port-suite.ts';
import { runSuite } from '../testing/run-suite.ts';

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

const onPostgreSQL: SettingsOf = async () => {
  const name = `workflow_host_${randomUUID().replaceAll('-', '')}`;
  await administered(`CREATE DATABASE ${name}`);
  await administered(`ALTER DATABASE ${name} SET synchronous_commit = off`);
  onTestFinished(async () => {
    await administered(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return { store: 'postgresql', connectionString: database.href };
};

describe.skipIf(skipped)(`the host on PostgreSQL${notice}`, () => {
  describe('its ports', () => {
    portSuite(onPostgreSQL);
  });

  describe('a workflow it runs', () => {
    runSuite(onPostgreSQL);
  });

  describe('a long run', () => {
    longRunSuite(onPostgreSQL);
  });

  describe('killed while it dispatches, then started again', () => {
    failureSuite(onPostgreSQL);
  });

  describe('one of two hosts on one database', () => {
    leaseSuite(onPostgreSQL);
    claimSuite(onPostgreSQL);
  });
});
