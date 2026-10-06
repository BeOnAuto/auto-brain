import { runStreamOf } from '@beonauto/operations';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from './inline-projection.ts';
import { replayedRow, type RunOutcomeKeeping } from './run-outcome-projection.ts';
import {
  messagesIn,
  namesIn,
  rowWrite,
  runOutcomesTable,
  runOutcomesVersion,
  streamsIn,
  tableDrop,
} from './run-outcome-statements.ts';

export type InTransaction = (work: (execute: StatementExecutor) => Promise<void>) => Promise<void>;

const runStreamsInABatch = 1000;

const versionedTable = /^run_outcomes_(?<version>\d+)$/u;

function isEarlierVersion(name: string): boolean {
  const version = versionedTable.exec(name)?.groups?.['version'];
  return version !== undefined && Number(version) < runOutcomesVersion;
}

async function replayed(keeping: RunOutcomeKeeping, execute: StatementExecutor, stream: string): Promise<void> {
  const run = runStreamOf(stream);
  if (run === undefined) {
    return;
  }
  const row = replayedRow(keeping, await messagesIn(execute, keeping.statements.messagesOf(stream)));
  if (row !== undefined) {
    await execute.command(rowWrite(run, row));
  }
}

async function filledAfter(keeping: RunOutcomeKeeping, execute: StatementExecutor, after: string): Promise<void> {
  const streams = await streamsIn(execute, keeping.statements.runStreamsAfter(after, runStreamsInABatch));
  await inTurn(streams, (stream) => replayed(keeping, execute, stream));
  const last = streams.at(-1);
  if (last !== undefined && streams.length === runStreamsInABatch) {
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
