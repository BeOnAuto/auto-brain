import type { ContentStore } from '@on.auto/operations';

import type { StatementExecutor } from '../event-store.ts';
import { formattedFor } from '../postgresql-reads/recorded-parts.ts';
import { postgresqlContent } from './content-dialects.ts';
import { recordedContentOn } from './content-store.ts';
import { contentSweepOn } from './content-sweep.ts';

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
  const formatted = formattedFor(async (text, values) => (await querying.query(text, values)).rows);
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

export function postgresqlContentOn(connections: ContentConnections): ContentStore {
  const execute = executorOn(connections);
  return {
    content: recordedContentOn(execute, postgresqlContent, (work) => inTransactionOn(connections, work)),
    sweepContent: contentSweepOn(execute),
  };
}
