import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { describe, expect, it } from 'vitest';

import type { StatementExecutor } from '../event-store.ts';
import { postgresqlSchemaCreated } from './postgresql-schema.ts';

function executorFinding(names: readonly string[]): {
  readonly execute: StatementExecutor;
  readonly commands: string[];
} {
  const commands: string[] = [];
  return {
    commands,
    execute: {
      query: () => Promise.resolve({ rows: names.map((name) => ({ name })) }),
      command: (sql) => {
        commands.push(SQL.describe(sql, pgFormatter).replaceAll(/\s+/gu, ' ').split(' (')[0] ?? '');
        return Promise.resolve();
      },
    },
  };
}

const firstContentTable = 'CREATE TABLE IF NOT EXISTS recorded_content_chunks';

const theContentTables = [firstContentTable, 'CREATE TABLE IF NOT EXISTS recorded_content_heads'];

describe("the ledger's own schema on PostgreSQL", () => {
  it("creates the brain's indexes and then the tables of the content it keeps, each only when missing", async () => {
    const empty = executorFinding([]);
    const found = executorFinding(['recorded_content_chunks', 'recorded_content_heads']);

    await postgresqlSchemaCreated(empty.execute);
    await postgresqlSchemaCreated(found.execute);

    expect(empty.commands.filter((command) => command.startsWith('CREATE TABLE'))).toEqual(theContentTables);
    expect(empty.commands.indexOf(firstContentTable)).toBeGreaterThan(
      empty.commands.findLastIndex((command) => command.startsWith('CREATE INDEX')),
    );
    expect(found.commands.filter((command) => command.startsWith('CREATE TABLE'))).toEqual([]);
  });
});
