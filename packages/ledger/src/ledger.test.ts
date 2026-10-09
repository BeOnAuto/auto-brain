import { DatabaseSync } from 'node:sqlite';

import { SQL, dumbo } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, onTestFinished } from 'vitest';

import { definitionStreamsQuery } from './definitions/sqlite-definition-streams.ts';
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

async function definitionStreamsIndexed(fileName: string): Promise<boolean> {
  const pool = dumbo(sqlite3EventStoreDriver.mapToDumboOptions({ fileName }));
  try {
    const { rows } = await pool.execute.query(SQL`EXPLAIN QUERY PLAN ${definitionStreamsQuery('recall')}`);
    return JSON.stringify(rows).includes('USING INDEX ledger_definition_streams');
  } finally {
    await pool.close();
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
  ledgerOn: (fileName, runOutcomes, projections = []) =>
    ledgerLayer({ fileName, projections, ...(runOutcomes === undefined ? {} : { runOutcomes }) }),
  storeOn: (fileName) => sqliteEventStore(() => ({ driver: sqlite3EventStoreDriver, fileName })),
  untilReadable: () => Promise.resolve(),
  queried,
  definitionStreamsIndexed,
  outcomeTables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'run_outcomes_*' ORDER BY name",
  projectionTables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'run_tallies_*' ORDER BY name",
  projectionIndexes: "SELECT name FROM sqlite_master WHERE type = 'index' AND name GLOB 'run_tallies_*' ORDER BY name",
  topicTables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'topics_*' ORDER BY name",
};

describe('The ledger on SQLite', () => {
  ledgerBehaviour(onSQLite);
});
