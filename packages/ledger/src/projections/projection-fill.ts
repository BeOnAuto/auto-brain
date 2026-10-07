import { projectedTableOf, runStreamOf } from '@beonauto/operations';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from './inline-projection.ts';
import { replayedRow, type ProjectionKeeping, type ReplayedMessage } from './projection-keeping.ts';
import {
  createdTable,
  messagesIn,
  namesIn,
  rowsWrite,
  streamsIn,
  tableAnalysis,
  tableDrop,
  type ProjectedRunRowOf,
  type SizedStream,
} from './projection-statements.ts';

export type InTransaction = (work: (execute: StatementExecutor) => Promise<void>) => Promise<void>;

const runStreamsInABatch = 100;

const mostBytesInABatch = 16 * 1024 * 1024;

function isEarlierVersion({ projection }: ProjectionKeeping, table: string): boolean {
  const version = new RegExp(`^${projection.name}_(?<version>\\d+)$`, 'u').exec(table)?.groups?.['version'];
  return version !== undefined && Number(version) < projection.version;
}

function chunksOf<Item>(items: readonly Item[], size: number): readonly (readonly Item[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function replayedRows(
  keeping: ProjectionKeeping,
  streams: readonly string[],
  messages: readonly ReplayedMessage[],
): readonly ProjectedRunRowOf[] {
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
  keeping: ProjectionKeeping,
  execute: StatementExecutor,
  batch: Batch,
): Promise<Batch | undefined> {
  const { dialect, projection } = keeping;
  const listed = await streamsIn(execute, dialect.runStreamsAfter(batch.after, batch.listing, projection.types));
  const streams = withinBytes(listed);
  const messages = streams.length === 0 ? [] : await messagesIn(execute, dialect.messagesOf(streams, projection.types));
  const kept = replayedRows(keeping, streams, messages);
  await inTurn(chunksOf(kept, dialect.rowsInAWrite(projection.columns.length)), (rows) =>
    execute.command(rowsWrite(dialect, projection, rows)),
  );
  return batchAfter(batch, listed, streams);
}

async function filledFrom(keeping: ProjectionKeeping, execute: StatementExecutor, batch: Batch): Promise<void> {
  const next = await batchFilled(keeping, execute, batch);
  if (next !== undefined) {
    await filledFrom(keeping, execute, next);
  }
}

async function created(
  keeping: ProjectionKeeping,
  execute: StatementExecutor,
  tables: readonly string[],
): Promise<void> {
  const { dialect, projection } = keeping;
  await inTurn(createdTable(dialect, projection), (statement) => execute.command(statement));
  await filledFrom(keeping, execute, { after: '', listing: 1 });
  await inTurn(
    tables.filter((name) => isEarlierVersion(keeping, name)),
    (name) => execute.command(tableDrop(name)),
  );
  await execute.command(tableAnalysis(projection));
}

async function preparedProjection(
  keeping: ProjectionKeeping,
  execute: StatementExecutor,
  inTransaction: InTransaction,
): Promise<void> {
  const tables = await namesIn(execute, keeping.dialect.tableVersions(keeping.projection.name));
  if (!tables.includes(projectedTableOf(keeping.projection))) {
    await inTransaction((transaction) => created(keeping, transaction, tables));
  }
}

export async function preparedProjections(
  keepings: readonly ProjectionKeeping[],
  execute: StatementExecutor,
  inTransaction: InTransaction,
): Promise<void> {
  await inTurn(keepings, (keeping) => preparedProjection(keeping, execute, inTransaction));
}
