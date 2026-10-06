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

interface Batch {
  readonly after: string;
  readonly listing: number;
}

function batchAfter({ listing }: Batch, listed: readonly SizedStream[], taken: readonly string[]): Batch | undefined {
  const last = taken.at(-1);
  if (last === undefined || (taken.length === listed.length && listed.length < listing)) {
    return undefined;
  }
  const takenBytes = listed.slice(0, taken.length).reduce((total, { size }) => total + size, 0);
  const fitting = Math.floor((mostBytesInABatch * taken.length) / takenBytes);
  return { after: last, listing: Math.max(1, Math.min(runStreamsInABatch, 2 * listing, fitting)) };
}

async function batchFilled(
  keeping: RunOutcomeKeeping,
  execute: StatementExecutor,
  batch: Batch,
): Promise<Batch | undefined> {
  const { statements, mapping } = keeping;
  const listed = await streamsIn(execute, statements.runStreamsAfter(batch.after, batch.listing, mapping.types));
  const streams = withinBytes(listed);
  const messages = streams.length === 0 ? [] : await messagesIn(execute, statements.messagesOf(streams, mapping.types));
  const kept = replayedRows(keeping, streams, messages);
  await inTurn(chunksOf(kept, statements.rowsInAWrite), (rows) => execute.command(rowsWrite(rows)));
  return batchAfter(batch, listed, streams);
}

async function filledFrom(keeping: RunOutcomeKeeping, execute: StatementExecutor, batch: Batch): Promise<void> {
  const next = await batchFilled(keeping, execute, batch);
  if (next !== undefined) {
    await filledFrom(keeping, execute, next);
  }
}

async function created(
  keeping: RunOutcomeKeeping,
  execute: StatementExecutor,
  tables: readonly string[],
): Promise<void> {
  const { statements } = keeping;
  await inTurn(statements.create(), (statement) => execute.command(statement));
  await filledFrom(keeping, execute, { after: '', listing: 1 });
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
