import { DatabaseSync } from 'node:sqlite';

import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqliteEventStore } from '../sqlite-event-store.ts';
import { openLedger } from '../testing/open-ledger.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import type { IndexExecutor } from './missing-indexes.ts';
import { createSQLiteBrainIndexes } from './sqlite-recorded.ts';

const brainIndexes = [
  'ledger_first_messages_by_kind',
  'ledger_messages_by_brain',
  'ledger_messages_by_brain_and_time',
  'ledger_messages_by_stream',
];

function aDatabaseFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

function indexesOf(fileName: string): readonly string[] {
  const database = new DatabaseSync(fileName, { readOnly: true });
  onTestFinished(() => {
    database.close();
  });
  const listed = database
    .prepare(
      "SELECT group_concat(name, ' ') AS names FROM (SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'ledger%' ORDER BY name)",
    )
    .get()?.['names'];
  return String(listed).split(' ');
}

function executorFinding(names: readonly string[]): { readonly execute: IndexExecutor; readonly commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    execute: {
      query: () => Promise.resolve({ rows: names.map((name) => ({ name })) }),
      command: (sql) => {
        commands.push(SQL.describe(sql, sqliteFormatter).replaceAll(/\s+/gu, ' '));
        return Promise.resolve();
      },
    },
  };
}

describe("the brain's indexes on SQLite", () => {
  it('are created when the ledger opens, once however often it opens', async () => {
    const fileName = aDatabaseFile();
    const first = await openLedger(fileName);
    await first.dispose();
    const second = await openLedger(fileName);
    await second.dispose();

    expect(indexesOf(fileName)).toEqual(brainIndexes);
  });

  it('are created only when missing, so a start that finds them issues no CREATE', async () => {
    const present = executorFinding(brainIndexes);
    const oneMissing = executorFinding(brainIndexes.filter((name) => name !== 'ledger_messages_by_stream'));

    await createSQLiteBrainIndexes(present.execute);
    await createSQLiteBrainIndexes(oneMissing.execute);

    expect([present.commands, oneMissing.commands]).toEqual([
      [],
      ['CREATE INDEX IF NOT EXISTS ledger_messages_by_stream ON emt_messages (stream_id, global_position)'],
    ]);
  });
});

describe('an event store on SQLite given hooks of its own', () => {
  it('keeps its hook, which runs after the schema is created, and still creates the indexes', async () => {
    const fileName = aDatabaseFile();
    const hooked: string[] = [];
    const store = sqliteEventStore(() => ({
      driver: sqlite3EventStoreDriver,
      fileName,
      hooks: {
        onAfterSchemaCreated: () => {
          hooked.push('after the schema');
        },
      },
    }));
    onTestFinished(() => store.close());

    await store.migrate();

    expect([hooked, indexesOf(fileName)]).toEqual([['after the schema'], brainIndexes]);
  });
});
