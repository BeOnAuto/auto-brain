import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';
import { Pool } from 'pg';

import { emmettEventStore } from '../emmett/emmett-event-store.ts';
import type { EventStore } from '../event-store.ts';
import { createPostgreSQLBrainIndexes } from './brain-indexes.ts';
import { dataAsJsonText } from './json-text.ts';
import { postgresqlRecordedStore } from './postgresql-recorded.ts';

export interface PostgreSQLOptions {
  readonly connectionString: string;
}

export interface PostgreSQLStoreOptions extends PostgreSQLOptions {
  readonly reportLostConnection: (error: Readonly<Error>) => void;
}

const eventsInOneBoundedAppend = 64;

export function postgresqlEventStore({ connectionString, reportLostConnection }: PostgreSQLStoreOptions): EventStore {
  const pool = new Pool({ connectionString });
  pool.on('error', reportLostConnection);
  const store = emmettEventStore(
    getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString,
      connectionOptions: { pool },
      schema: { autoMigration: 'None' },
      hooks: { onAfterSchemaCreated: createPostgreSQLBrainIndexes },
    }),
    { data: dataAsJsonText, mostEventsInOneAppend: eventsInOneBoundedAppend },
  );
  return {
    ...store,
    ...postgresqlRecordedStore(
      async (text, values) => (await pool.query<Readonly<Record<string, unknown>>>(text, [...values])).rows,
    ),
    close: async () => {
      await store.close();
      await pool.end();
    },
  };
}
