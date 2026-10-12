import type { RecordedContent } from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';

import type { StatementExecutor } from '../event-store.ts';
import { postgresqlContent } from './content-dialects.ts';
import { recordedContentOn } from './content-store.ts';

interface Answer {
  readonly rows: readonly unknown[];
}

interface Querying {
  query(text: string, values: readonly unknown[]): Promise<Answer>;
}

export interface ContentConnection extends Querying {
  release(): void;
}

export interface ContentConnections extends Querying {
  connect(): Promise<ContentConnection>;
}

function executorOn(querying: Querying): StatementExecutor {
  const formatted = async (sql: SQL): Promise<readonly unknown[]> => {
    const { query: text, params } = SQL.format(sql, pgFormatter);
    return (await querying.query(text, params)).rows;
  };
  return { query: async (sql) => ({ rows: await formatted(sql) }), command: formatted };
}

async function inTransactionOn(
  connections: ContentConnections,
  work: (execute: StatementExecutor) => Promise<void>,
): Promise<void> {
  const connection = await connections.connect();
  try {
    await connection.query('BEGIN', []);
    await work(executorOn(connection));
    await connection.query('COMMIT', []);
  } catch (failure) {
    await connection.query('ROLLBACK', []);
    throw failure;
  } finally {
    connection.release();
  }
}

export function postgresqlContentOn(connections: ContentConnections): RecordedContent {
  return recordedContentOn(executorOn(connections), postgresqlContent, (work) => inTransactionOn(connections, work));
}
