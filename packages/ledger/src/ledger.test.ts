import { DatabaseSync } from 'node:sqlite';

import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, onTestFinished } from 'vitest';

import { sqliteEventStore } from './index.ts';
import { ledgerLayer } from './sqlite3.ts';
import { ledgerBehaviour } from './testing/ledger-behaviour.ts';
import type { LedgerEntry } from './testing/ledger-entry.ts';
import { temporaryDatabase } from './testing/temporary-database.ts';

function queried(fileName: string, statement: string): Promise<readonly unknown[]> {
  const database = new DatabaseSync(fileName);
  try {
    return Promise.resolve(database.prepare(statement).all());
  } finally {
    database.close();
  }
}

const onSQLite: LedgerEntry = {
  mostEventsInOneAppend: 8,
  afterClosing: 'Bounded connection pool has been closed',
  closedWhileWriting: 'TaskProcessor has been stopped',
  aDatabase: () => {
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);
    return Promise.resolve(fileName);
  },
  ledgerOn: (fileName, runOutcomes) => ledgerLayer({ fileName, ...(runOutcomes === undefined ? {} : { runOutcomes }) }),
  storeOn: (fileName) => sqliteEventStore(() => ({ driver: sqlite3EventStoreDriver, fileName })),
  untilReadable: () => Promise.resolve(),
  queried,
  outcomeTables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'run_outcomes_*' ORDER BY name",
};

describe('The ledger on SQLite', () => {
  ledgerBehaviour(onSQLite);
});
