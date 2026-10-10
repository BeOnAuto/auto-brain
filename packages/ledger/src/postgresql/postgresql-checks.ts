import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { onTestFinished } from 'vitest';

import type { RecordedStore } from '../event-store.ts';
import { definitionStreamsPlan } from '../postgresql-reads/index-checks.ts';
import { postgresqlRecordedStore } from '../postgresql-reads/postgresql-recorded.ts';

export async function queried(database: string, statement: string): Promise<readonly unknown[]> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    const { rows } = await client.query<Readonly<Record<string, unknown>>>(statement);
    return rows;
  } finally {
    await client.end();
  }
}

export async function definitionStreamsIndexed(database: string): Promise<boolean> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query('SET enable_seqscan = off');
    const { explained, values, throughTheIndex } = definitionStreamsPlan;
    const plan = await client.query<Readonly<Record<string, unknown>>>(explained, values);
    return plan.rows.some((row) => String(row['QUERY PLAN']).includes(throughTheIndex));
  } finally {
    await client.end();
  }
}

export async function planOf(database: string, read: (store: RecordedStore) => Promise<unknown>): Promise<string> {
  const asked: { readonly text: string; readonly values: readonly unknown[] }[] = [];
  await read(
    postgresqlRecordedStore((text, values) => {
      asked.push({ text, values });
      return Promise.resolve([]);
    }),
  );
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query('SET enable_seqscan = off');
    const plans = await Promise.all(
      asked.map(({ text, values }) => client.query<Readonly<Record<string, unknown>>>(`EXPLAIN ${text}`, [...values])),
    );
    const lines: string[] = [];
    for (const { rows } of plans) {
      lines.push(...rows.map((row) => String(row['QUERY PLAN'])));
    }
    return lines.join('\n');
  } finally {
    await client.end();
  }
}

export async function aDatabaseOn(server: string): Promise<string> {
  const name = `ledger_${randomUUID().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await queried(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}
