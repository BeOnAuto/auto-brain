import { DatabaseSync } from 'node:sqlite';

import { SQL, dumbo } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';

import { definitionStreamsQuery } from '../definitions/sqlite-definition-streams.ts';
import type { RecordedStore } from '../event-store.ts';
import { sqliteRecordedStore } from './sqlite-recorded.ts';

export function queried(fileName: string, statement: string): Promise<readonly unknown[]> {
  const database = new DatabaseSync(fileName);
  try {
    return Promise.resolve(database.prepare(statement).all());
  } finally {
    database.close();
  }
}

export async function definitionStreamsIndexed(fileName: string): Promise<boolean> {
  const pool = dumbo(sqlite3EventStoreDriver.mapToDumboOptions({ fileName }));
  try {
    const { rows } = await pool.execute.query(SQL`EXPLAIN QUERY PLAN ${definitionStreamsQuery('recall')}`);
    return JSON.stringify(rows).includes('USING INDEX ledger_definition_streams');
  } finally {
    await pool.close();
  }
}

export async function planOf(fileName: string, read: (store: RecordedStore) => Promise<unknown>): Promise<string> {
  const asked: SQL[] = [];
  const pool = dumbo(sqlite3EventStoreDriver.mapToDumboOptions({ fileName }));
  try {
    await read(
      sqliteRecordedStore({
        ...pool.execute,
        query: (sql) => {
          asked.push(sql);
          return pool.execute.query(sql);
        },
      }),
    );
    const plans = await pool.execute.batchQuery(asked.map((sql) => SQL`EXPLAIN QUERY PLAN ${sql}`));
    return JSON.stringify(plans);
  } finally {
    await pool.close();
  }
}
