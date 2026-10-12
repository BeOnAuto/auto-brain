import { DatabaseSync } from 'node:sqlite';

import { conversations, openRequests, openRequestsName } from '@beonauto/interaction';
import {
  alpha,
  answererId,
  chatHarness,
  conversationRows,
  farAhead,
  type HarnessLedger,
} from '@beonauto/interaction/testing';
import { postgresqlLedgerLayer } from '@beonauto/ledger/postgresql';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { Ledger, projectedTableOf } from '@beonauto/operations';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const projections = [openRequests, conversations];

const tables = projections.map((projection) => projectedTableOf(projection));

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function opened(layer: Layer.Layer<Ledger>): Promise<HarnessLedger> {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  const service = await runtime.runPromise(Ledger);
  return { service, layer: Layer.succeed(Ledger, service) };
}

interface Place {
  readonly open: () => Promise<HarnessLedger>;
  readonly dropTables: () => Promise<void>;
}

function onSQLite(): Promise<Place> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve({
    open: () => opened(ledgerLayer({ fileName: ledger.fileName, projections })),
    dropTables: () => {
      const database = new DatabaseSync(ledger.fileName);
      try {
        for (const table of tables) {
          database.exec(`DROP TABLE ${table}`);
        }
      } finally {
        database.close();
      }
      return Promise.resolve();
    },
  });
}

async function administer(connectionString: string, statement: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onPostgreSQL(): Promise<Place> {
  const name = `filled_${crypto.randomUUID().replaceAll('-', '')}`;
  await administer(postgresql, `CREATE DATABASE ${name}`);
  onTestFinished(() => administer(postgresql, `DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(postgresql);
  url.pathname = `/${name}`;
  return {
    open: () => opened(postgresqlLedgerLayer({ connectionString: url.href, projections })),
    dropTables: () => administer(url.href, tables.map((table) => `DROP TABLE ${table}`).join('; ')),
  };
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly aPlace: () => Promise<Place>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, aPlace: onSQLite },
  { store: `PostgreSQL${notice}`, skipped: postgresql === '', aPlace: onPostgreSQL },
];

const advancedByTheReader = new Set(conversations.advanced?.columns);

function foldedColumnsOf(row: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(row).filter(([column]: readonly [string, unknown]) => !advancedByTheReader.has(column)),
  );
}

async function rowsOf(ledger: HarnessLedger) {
  const requests = await Effect.runPromise(
    ledger.service.readProjectedRows(openRequestsName, alpha, { where: [], orderBy: [], order: 'asc', limit: 50 }),
  );
  const conversationsRead = await conversationRows(ledger);
  return {
    requests: requests.map(({ row }) => row),
    conversations: conversationsRead.map(({ row }) => foldedColumnsOf(row)),
  };
}

describe.each(stores)('the projections of the requests and the conversations on $store', ({ skipped, aPlace }) => {
  it.skipIf(skipped)(
    'are filled from the history of the playbook when their tables are new, each row as the appends folded it, the cadence its reader advances aside',
    async () => {
      const place = await aPlace();
      const playbook = await chatHarness({ ledger: await place.open() });
      await playbook.askInThread(runId);
      await playbook.performDue(Date.now());
      const [thread = ''] = playbook.chat.posted().map(({ ts }) => ts);
      playbook.chat.reply({ channel: '#approvals-sales', thread, user: answererId, text: 'maybe later' });
      await playbook.performReads(Date.now() + farAhead);
      const kept = await rowsOf(playbook.ledger);

      await place.dropTables();
      const filled = await rowsOf(await place.open());

      expect(kept.requests).toMatchObject([
        { function: 'approve-brief', version: 1, standing: 'delivered', reply_refusals: 1, refusals_told: 1 },
      ]);
      expect(kept.conversations).toHaveLength(1);
      expect(filled).toEqual(kept);
    },
  );
});
