import { randomUUID } from 'node:crypto';

import type { RecordedEvent } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement, textOnPostgreSQL } from '../database/statement.ts';
import { runGateOf } from '../follower/run-gate.ts';
import { openedOn } from '../testing/host-files.ts';
import { insertedListener } from './listener-rows.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const brainKey = 'brain/acme/alpha/';

const runId = 'acme/alpha/r-1';

const stream = `${brainKey}runs/r-1`;

const PassedRow = Schema.Struct({ listener: Schema.String, passed: WholeNumber });

async function connected(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

async function aDatabase(): Promise<string> {
  const name = `workflow_host_${randomUUID().replaceAll('-', '')}`;
  const administration = await connected(server);
  await administration.query(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    const dropping = new Client({ connectionString: server });
    await dropping.connect();
    await dropping.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await dropping.end();
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

const record: RecordedEvent = {
  id: 'record-2',
  cursor: 'cursor-2',
  causationId: null,
  correlationId: null,
  stream,
  version: 2,
  type: 'input_applied',
  data: null,
  recordedAt: '2026-10-01T09:00:00.000Z',
};

function holdingTheListener(
  database: HostDatabase,
  held: Readonly<Pick<Client, 'query'>>,
  meanwhile: () => Promise<unknown>,
): HostDatabase {
  return {
    ...database,
    write: (written) =>
      written.strings.join('').includes('INSERT INTO workflow_listeners')
        ? Effect.promise(async () => {
            await held.query('BEGIN');
            await held.query(textOnPostgreSQL(written), [...written.values]);
            await meanwhile();
            await held.query('COMMIT');
            return [];
          })
        : database.write(written),
  };
}

describe.skipIf(server === '')('a listener kept while the gate passes its run early, on PostgreSQL', () => {
  it(
    'is marked passed though its insert was still open when the gate marked the run passed',
    { timeout: 30_000 },
    async () => {
      const connectionString = await aDatabase();
      const database = await openedOn({ store: 'postgresql', connectionString });
      const held = await connected(connectionString);
      await Effect.runPromise(
        database.write(
          statement`INSERT INTO workflow_runs (run_id, stream_id, dispatched_through) VALUES (${runId}, ${stream}, ${0})`,
        ),
      );
      const passing = () => Effect.runPromise(runGateOf(database, brainKey).verdictOn(record, true));

      await Effect.runPromise(
        insertedListener(holdingTheListener(database, held, passing), {
          runId,
          listener: 'held',
          brainKey,
          streamId: stream,
          armedBy: 2,
          filters: '[]',
          workflow: 'wait',
          passed: false,
        }),
      );
      const listeners = await Effect.runPromise(
        rowsOf(PassedRow, database.read(statement`SELECT listener, passed FROM workflow_listeners`)),
      );

      expect(listeners).toEqual([{ listener: 'held', passed: 1 }]);
    },
  );
});
