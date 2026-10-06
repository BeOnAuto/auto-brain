import { runStreamOf } from '@beonauto/operations';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn, type StoredMessage } from './inline-projection.ts';
import { replayedRow, type RunOutcomeKeeping } from './run-outcome-projection.ts';
import {
  messagesIn,
  namesIn,
  rowsWrite,
  runOutcomesTable,
  runOutcomesVersion,
  streamsIn,
  tableDrop,
  type KeptRow,
  type SizedStream,
} from './run-outcome-statements.ts';

export type InTransaction = (work: (execute: StatementExecutor) => Promise<void>) => Promise<void>;

const runStreamsInABatch = 100;

const mostBytesInABatch = 16 * 1024 * 1024;

const versionedTable = /^run_outcomes_(?<version>\d+)$/u;

function isEarlierVersion(name: string): boolean {
  const version = versionedTable.exec(name)?.groups?.['version'];
  return version !== undefined && Number(version) < runOutcomesVersion;
}

function chunksOf<Item>(items: readonly Item[], size: number): readonly (readonly Item[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function replayedRows(
  keeping: RunOutcomeKeeping,
  streams: readonly string[],
  messages: readonly StoredMessage[],
): readonly KeptRow[] {
  const byStream = Map.groupBy(messages, ({ stream }) => stream);
  return streams.flatMap((stream) => {
    const run = runStreamOf(stream);
    const row = run === undefined ? undefined : replayedRow(keeping, byStream.get(stream) ?? []);
    return run === undefined || row === undefined ? [] : [{ run, row }];
  });
}

function withinBytes(listed: readonly SizedStream[]): readonly string[] {
  const taken: string[] = [];
  let loaded = 0;
  for (const { stream, size } of listed) {
    if (taken.length > 0 && loaded + size > mostBytesInABatch) {
      return taken;
    }
    taken.push(stream);
    loaded += size;
  }
  return taken;
}

async function batchFilledAfter(
  keeping: RunOutcomeKeeping,
  execute: StatementExecutor,
  after: string,
): Promise<string | undefined> {
  const { statements, mapping } = keeping;
  const listed = await streamsIn(execute, statements.runStreamsAfter(after, runStreamsInABatch, mapping.types));
  const streams = withinBytes(listed);
  const messages = streams.length === 0 ? [] : await messagesIn(execute, statements.messagesOf(streams, mapping.types));
  const kept = replayedRows(keeping, streams, messages);
  await inTurn(chunksOf(kept, statements.rowsInAWrite), (rows) => execute.command(rowsWrite(rows)));
  return streams.length < listed.length || listed.length === runStreamsInABatch ? streams.at(-1) : undefined;
}

async function filledAfter(keeping: RunOutcomeKeeping, execute: StatementExecutor, after: string): Promise<void> {
  const last = await batchFilledAfter(keeping, execute, after);
  if (last !== undefined) {
    await filledAfter(keeping, execute, last);
  }
}

async function created(
  keeping: RunOutcomeKeeping,
  execute: StatementExecutor,
  tables: readonly string[],
): Promise<void> {
  const { statements } = keeping;
  await inTurn(statements.create(), (statement) => execute.command(statement));
  await filledAfter(keeping, execute, '');
  await inTurn(
    tables.filter((name) => isEarlierVersion(name)),
    (name) => execute.command(tableDrop(name)),
  );
  await inTurn(statements.afterFill(), (statement) => execute.command(statement));
}

export async function preparedRunOutcomes(
  keeping: RunOutcomeKeeping,
  execute: StatementExecutor,
  inTransaction: InTransaction,
): Promise<void> {
  const tables = await namesIn(execute, keeping.statements.tableVersions());
  if (!tables.includes(runOutcomesTable)) {
    await inTransaction((transaction) => created(keeping, transaction, tables));
  }
}
