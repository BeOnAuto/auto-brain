import { randomUUID } from 'node:crypto';

import { openRequests } from '@beonauto/interaction';
import {
  askedRunId,
  askedThroughPartner,
  attemptedThenStopped,
  type HarnessLedger,
} from '@beonauto/interaction/testing';
import { postgresqlLedgerLayer } from '@beonauto/ledger/postgresql';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { Ledger } from '@beonauto/operations';
import { Layer, ManagedRuntime } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const days = 24 * 60 * 60_000;

const anyTime: unknown = expect.any(String);

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function opened(layer: Layer.Layer<Ledger>): Promise<HarnessLedger> {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  const service = await runtime.runPromise(Ledger);
  return { service, layer: Layer.succeed(Ledger, service) };
}

function onSQLite(): Promise<HarnessLedger> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return opened(ledgerLayer({ fileName: ledger.fileName, projections: [openRequests] }));
}

async function onPostgreSQL(): Promise<HarnessLedger> {
  const name = `crashes_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(() => administer(`DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(postgresql);
  url.pathname = `/${name}`;
  return opened(postgresqlLedgerLayer({ connectionString: url.href, projections: [openRequests] }));
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly aLedger: () => Promise<HarnessLedger>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, aLedger: onSQLite },
  { store: `PostgreSQL${notice}`, skipped: postgresql === '', aLedger: onPostgreSQL },
];

describe.each(stores)(
  'a server that stopped between a delivery and its settlement, on $store',
  ({ skipped, aLedger }) => {
    it.skipIf(skipped)('settles an answer given within the delivery from its end, after the expiry too', async () => {
      const asked = await askedThroughPartner({ answers: true, ledger: await aLedger() });
      asked.receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'approve' }) });

      const stopped = await attemptedThenStopped(asked);
      const afterStop = await asked.brain.firstOpen();
      await asked.brain.performDue(asked.askedAt + 3 * days);

      expect([stopped, afterStop]).toMatchObject([true, { standing: 'answered' }]);
      expect(await asked.brain.runOf(askedRunId)).toMatchObject({
        output: { status: 'succeeded', output: { choice: 'approve' }, record: { answered_by: 'channel:partner' } },
      });
      expect(asked.receiver.received()).toHaveLength(1);
    });

    it.skipIf(skipped)('succeeds a delivered notification from the end of its delivery', async () => {
      const asked = await askedThroughPartner({ notification: true, ledger: await aLedger() });

      await attemptedThenStopped(asked);
      await asked.brain.performDue(Date.now());

      expect(await asked.brain.runOf(askedRunId)).toMatchObject({
        output: { status: 'succeeded', output: {}, record: { delivered_at: anyTime } },
      });
      expect(asked.receiver.received()).toHaveLength(1);
    });
  },
);
