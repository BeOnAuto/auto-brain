import type { RunOutcomeMapping, RunProjection } from '@beonauto/operations';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';
import { Pool } from 'pg';

import { emmettEventStore } from '../emmett/emmett-event-store.ts';
import type { LedgerStore } from '../event-store.ts';
import { dataAsJsonText } from './json-text.ts';
import { formattedFor, postgresqlProjectionsOf } from './postgresql-projections.ts';
import { postgresqlRecordedStore, type Query } from './postgresql-recorded.ts';
import { postgresqlRunOutcomesOf } from './postgresql-run-outcomes.ts';

export interface PostgreSQLOptions {
  readonly connectionString: string;
  readonly runOutcomes?: RunOutcomeMapping;
  readonly projections?: readonly RunProjection[];
}

export interface PostgreSQLStoreOptions extends PostgreSQLOptions {
  readonly reportLostConnection: (error: Readonly<Error>) => void;
}

const eventsInOneBoundedAppend = 64;

export function postgresqlEventStore({
  connectionString,
  reportLostConnection,
  runOutcomes,
  projections,
}: PostgreSQLStoreOptions): LedgerStore {
  const pool = new Pool({ connectionString });
  pool.on('error', reportLostConnection);
  const kept = postgresqlProjectionsOf({ runOutcomes, projections });
  const store = emmettEventStore(
    getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString,
      connectionOptions: { pool },
      schema: { autoMigration: 'None' },
      projections: [...kept.registrations],
      hooks: { onAfterSchemaCreated: kept.afterTheSchema },
    }),
    { data: dataAsJsonText, mostEventsInOneAppend: eventsInOneBoundedAppend },
  );
  const query: Query = async (text, values) =>
    (await pool.query<Readonly<Record<string, unknown>>>(text, [...values])).rows;
  return {
    ...store,
    ...postgresqlRecordedStore(query),
    ...kept.readerOn(formattedFor(query)),
    readRunOutcomes: postgresqlRunOutcomesOf(runOutcomes, query),
    close: async () => {
      await store.close();
      await pool.end();
    },
  };
}
