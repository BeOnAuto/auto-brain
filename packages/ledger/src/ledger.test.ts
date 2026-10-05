import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, onTestFinished } from 'vitest';

import { sqliteEventStore } from './index.ts';
import { ledgerLayer } from './sqlite3.ts';
import { ledgerBehaviour } from './testing/ledger-behaviour.ts';
import type { LedgerEntry } from './testing/ledger-entry.ts';
import { temporaryDatabase } from './testing/temporary-database.ts';

const onSQLite: LedgerEntry = {
  mostEventsInOneAppend: 8,
  afterClosing: 'Bounded connection pool has been closed',
  closedWhileWriting: 'TaskProcessor has been stopped',
  aDatabase: () => {
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);
    return Promise.resolve(fileName);
  },
  ledgerOn: (fileName) => ledgerLayer({ fileName }),
  storeOn: (fileName) => sqliteEventStore(() => ({ driver: sqlite3EventStoreDriver, fileName })),
  untilReadable: () => Promise.resolve(),
};

describe('The ledger on SQLite', () => {
  ledgerBehaviour(onSQLite);
});
