import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';

const directory = join(import.meta.dirname, '..', '.data', 'message-id-probe');
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const fileName = join(directory, 'ledger.db');
const store = getSQLiteEventStore({ driver: sqlite3EventStoreDriver, fileName });
const stream = 'owf-run:probe';
const event = (messageId: string, note: string) => ({
  type: 'input_consumed',
  data: { note },
  metadata: { messageId },
});

async function attempt(label: string, work: () => Promise<unknown>): Promise<string> {
  try {
    const result = await work();
    return `${label}: appended ${JSON.stringify(result, (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value))}`;
  } catch (error) {
    return `${label}: rejected with ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
  }
}

const outcomes = [
  await attempt('first append, message m-1, expected version 0', () =>
    store.appendToStream(stream, [event('m-1', 'first')], { expectedStreamVersion: 0n }),
  ),
  await attempt('same message m-1 again, expected version 1 (a re-read writer)', () =>
    store.appendToStream(stream, [event('m-1', 'duplicate')], { expectedStreamVersion: 1n }),
  ),
  await attempt('message m-2 at the stale expected version 1', () =>
    store.appendToStream(stream, [event('m-2', 'stale')], { expectedStreamVersion: 1n }),
  ),
  await attempt('same message m-1 with no expected version', () =>
    store.appendToStream(stream, [event('m-1', 'unchecked')]),
  ),
];
await store.close();
const database = new DatabaseSync(fileName);
const rows = database
  .prepare(
    'SELECT stream_position, message_id, message_data FROM emt_messages WHERE stream_id = ? ORDER BY stream_position',
  )
  .all(stream);
const indexes = database
  .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'emt_messages'")
  .all();
const unique = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'emt_messages'").get();
database.close();
const report = { outcomes, rows, indexes, table: unique?.['sql'] };
console.log(JSON.stringify(report, null, 2));
writeFileSync(
  join(import.meta.dirname, '..', 'results', 'message-id-probe.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
