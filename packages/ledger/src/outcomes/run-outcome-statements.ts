import { RunOutcomeStatusSchema, type RunOutcome, type RunOutcomeGroup, type RunStream } from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';

export const runOutcomesVersion = 1;

export const runOutcomesTable = `run_outcomes_${runOutcomesVersion}`;

export const runOutcomesIndex = `${runOutcomesTable}_by_brain_and_day`;

export interface RunOutcomeStatements {
  readonly tableVersions: () => SQL;
  readonly create: () => readonly SQL[];
  readonly runStreamsAfter: (after: string, count: number) => SQL;
  readonly messagesOf: (streams: readonly string[], types: readonly string[]) => SQL;
  readonly rowsInAWrite: number;
  readonly filledData: (column: unknown) => unknown;
  readonly appendedData: (stored: unknown) => unknown;
  readonly rowOf: (run: RunStream) => SQL;
  readonly afterFill: () => readonly SQL[];
}

const table = SQL.plain(runOutcomesTable);

const RowSchema = Schema.Struct({
  started_day: Schema.String,
  started_at: Schema.String,
  last_started_at: Schema.String,
  primitive: Schema.String,
  name: Schema.String,
  status: RunOutcomeStatusSchema,
  duration_ms: Schema.NullOr(Schema.Number),
  input_tokens: Schema.NullOr(Schema.Number),
  output_tokens: Schema.NullOr(Schema.Number),
  cached_tokens: Schema.NullOr(Schema.Number),
});

const decodeRows = Schema.decodeUnknownSync(Schema.Array(RowSchema));

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

const StreamRows = Schema.Array(Schema.Struct({ stream: Schema.String }));

const MessageRows = Schema.Array(Schema.Struct({ stream: Schema.String, type: Schema.String, data: Schema.Unknown }));

function outcomeOf(row: typeof RowSchema.Type): RunOutcome {
  return {
    startedDay: row.started_day,
    startedAt: row.started_at,
    lastStartedAt: row.last_started_at,
    primitive: row.primitive,
    name: row.name,
    status: row.status,
    durationMs: row.duration_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedTokens: row.cached_tokens,
  };
}

export async function rowIn(execute: StatementExecutor, statements: RunOutcomeStatements, run: RunStream) {
  const { rows } = await execute.query(statements.rowOf(run));
  return decodeRows(rows)
    .map((row) => outcomeOf(row))
    .at(0);
}

export interface KeptRow {
  readonly run: RunStream;
  readonly row: RunOutcome;
}

function valuesOf({ run, row }: KeptRow): SQL {
  return SQL`(${run.brainKey}, ${run.runId}, ${row.startedDay}, ${row.startedAt}, ${row.lastStartedAt},
    ${row.primitive}, ${row.name}, ${row.status}, ${row.durationMs}, ${row.inputTokens}, ${row.outputTokens},
    ${row.cachedTokens})`;
}

export function rowsWrite(kept: readonly KeptRow[]): SQL {
  const values = SQL.merge(
    kept.map((each) => valuesOf(each)),
    ', ',
  );
  return SQL`INSERT INTO ${table} (brain_key, run_id, started_day, started_at, last_started_at, primitive, name,
      status, duration_ms, input_tokens, output_tokens, cached_tokens)
    VALUES ${values}
    ON CONFLICT (brain_key, run_id) DO UPDATE SET started_day = excluded.started_day,
      started_at = excluded.started_at, last_started_at = excluded.last_started_at, primitive = excluded.primitive,
      name = excluded.name, status = excluded.status, duration_ms = excluded.duration_ms,
      input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
      cached_tokens = excluded.cached_tokens`;
}

export function tableDrop(name: string): SQL {
  return SQL`DROP TABLE IF EXISTS ${SQL.plain(name)}`;
}

export async function namesIn(execute: StatementExecutor, query: SQL): Promise<readonly string[]> {
  const { rows } = await execute.query(query);
  return Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name);
}

export async function streamsIn(execute: StatementExecutor, query: SQL): Promise<readonly string[]> {
  const { rows } = await execute.query(query);
  return Schema.decodeUnknownSync(StreamRows)(rows).map(({ stream }) => stream);
}

export async function messagesIn(execute: StatementExecutor, query: SQL) {
  const { rows } = await execute.query(query);
  return Schema.decodeUnknownSync(MessageRows)(rows);
}

export const groupFields = {
  day: Schema.String,
  primitive: Schema.String,
  name: Schema.String,
  status: RunOutcomeStatusSchema,
  runs: Schema.Number,
  input_tokens: Schema.Number,
  output_tokens: Schema.Number,
  cached_tokens: Schema.Number,
};

export interface GroupRow {
  readonly day: string;
  readonly primitive: string;
  readonly name: string;
  readonly status: RunOutcomeGroup['status'];
  readonly runs: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cached_tokens: number;
  readonly durations: readonly number[];
}

export function groupOf(row: GroupRow): RunOutcomeGroup {
  return {
    day: row.day,
    primitive: row.primitive,
    name: row.name,
    status: row.status,
    runs: row.runs,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedTokens: row.cached_tokens,
    durations: row.durations,
  };
}
