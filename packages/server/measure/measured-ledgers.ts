import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Client } from 'pg';

export interface LedgerUse {
  readonly environment: Readonly<Record<string, string>>;
  readonly expireEveryRequestAt: (at: number) => Promise<number>;
}

export interface MeasuredLedger {
  readonly store: string;
  readonly aLedger: () => Promise<LedgerUse>;
  readonly removeAll: () => Promise<void>;
}

const expiring = 'UPDATE open_requests_1 SET expires_at = $1, due_at = $1';

async function administered(server: string, statement: string, values: readonly number[] = []): Promise<number> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    return (await client.query(statement, [...values])).rowCount ?? 0;
  } finally {
    await client.end();
  }
}

function onSQLite(): MeasuredLedger {
  const directories: string[] = [];
  return {
    store: 'SQLite',
    aLedger: () => {
      const directory = mkdtempSync(join(tmpdir(), 'auto-brain-server-measure-'));
      directories.push(directory);
      const file = join(directory, 'ledger.db');
      return Promise.resolve({
        environment: { LEDGER_FILE: file },
        expireEveryRequestAt: (at) => {
          const database = new DatabaseSync(file);
          const { changes } = database.prepare(expiring.replaceAll('$1', '?')).run(at, at);
          database.close();
          return Promise.resolve(Number(changes));
        },
      });
    },
    removeAll: () => {
      for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
      }
      return Promise.resolve();
    },
  };
}

function onPostgreSQL(server: string): MeasuredLedger {
  const names: string[] = [];
  return {
    store: 'PostgreSQL',
    aLedger: async () => {
      const name = `server_measure_${randomUUID().replaceAll('-', '')}`;
      await administered(server, `CREATE DATABASE ${name}`);
      names.push(name);
      const database = new URL(server);
      database.pathname = `/${name}`;
      return {
        environment: { DATABASE_URL: database.href },
        expireEveryRequestAt: (at) => administered(database.href, expiring, [at]),
      };
    },
    removeAll: async () => {
      await Promise.all(names.splice(0).map((name) => administered(server, `DROP DATABASE ${name} WITH (FORCE)`)));
    },
  };
}

export function measuredLedgers(postgresqlServer: string): readonly MeasuredLedger[] {
  return postgresqlServer === '' ? [onSQLite()] : [onSQLite(), onPostgreSQL(postgresqlServer)];
}
