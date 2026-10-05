import { CallResultSchema, type CallResult } from '@beonauto/operations';
import { CallKeySchema, type RunContext, type StartCall } from '@beonauto/workflow-engine';
import { Effect, Schema } from 'effect';

import { oneRowOf, rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';

const StartCallSchema = Schema.Struct({
  kind: Schema.Literal('start_call'),
  key: CallKeySchema,
  function: Schema.NonEmptyString,
  arguments: Schema.Json,
  longestMs: Schema.Int,
});

const CallText = Schema.fromJsonString(Schema.toCodecJson(StartCallSchema));

const AttributesText = Schema.fromJsonString(Schema.JsonObject);

const ResultText = Schema.fromJsonString(Schema.toCodecJson(CallResultSchema));

const encodeCall = Schema.encodeSync(CallText);

const encodeAttributes = Schema.encodeSync(AttributesText);

const encodeResult = Schema.encodeSync(ResultText);

const StateRow = Schema.Struct({
  state: Schema.Literals(['running', 'answered', 'cancelled']),
  result: Schema.NullOr(ResultText),
});

const UnfinishedRow = Schema.Struct({
  call_key: Schema.String,
  run_id: Schema.String,
  call: CallText,
  attributes: AttributesText,
  result: Schema.NullOr(ResultText),
});

export type CallState = typeof StateRow.Type;

export interface UnfinishedCall {
  readonly key: string;
  readonly call: StartCall;
  readonly run: RunContext;
  readonly result: CallResult | null;
}

export function startedRow(
  database: HostDatabase,
  key: string,
  call: StartCall,
  run: RunContext,
): Effect.Effect<boolean, DatabaseFailed> {
  return database
    .write(
      statement`INSERT INTO workflow_calls (call_key, run_id, state, call, attributes)
        VALUES (${key}, ${run.executionId}, 'running', ${encodeCall(call)}, ${encodeAttributes(run.attributes)})
        ON CONFLICT (call_key) DO NOTHING RETURNING state`,
    )
    .pipe(Effect.map((rows) => rows.length > 0));
}

export function cancelledRow(database: HostDatabase, key: string): Effect.Effect<boolean, DatabaseFailed> {
  return database
    .write(
      statement`UPDATE workflow_calls SET state = 'cancelled' WHERE call_key = ${key} AND state = 'running'
        RETURNING state`,
    )
    .pipe(Effect.map((rows) => rows.length > 0));
}

export function tombstonedRow(
  database: HostDatabase,
  key: string,
  runId: string,
): Effect.Effect<boolean, DatabaseFailed> {
  return database
    .write(
      statement`INSERT INTO workflow_calls (call_key, run_id, state) VALUES (${key}, ${runId}, 'cancelled')
        ON CONFLICT (call_key) DO NOTHING RETURNING state`,
    )
    .pipe(Effect.map((rows) => rows.length > 0));
}

export function answeredRow(
  database: HostDatabase,
  key: string,
  result: CallResult,
): Effect.Effect<boolean, DatabaseFailed> {
  return database
    .write(
      statement`UPDATE workflow_calls SET state = 'answered', result = ${encodeResult(result)}
        WHERE call_key = ${key} AND state = 'running' RETURNING state`,
    )
    .pipe(Effect.map((rows) => rows.length > 0));
}

export function deliveredRow(database: HostDatabase, key: string): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(database.write(statement`UPDATE workflow_calls SET delivered = 1 WHERE call_key = ${key}`));
}

export function callStateOf(database: HostDatabase, key: string): Effect.Effect<CallState, DatabaseFailed> {
  return oneRowOf(StateRow, database.read(statement`SELECT state, result FROM workflow_calls WHERE call_key = ${key}`));
}

export function unfinishedCalls(database: HostDatabase): Effect.Effect<readonly UnfinishedCall[], DatabaseFailed> {
  return rowsOf(
    UnfinishedRow,
    database.read(
      statement`SELECT call_key, run_id, call, attributes, result FROM workflow_calls
        WHERE state = 'running' OR (state = 'answered' AND delivered = 0)`,
    ),
  ).pipe(
    Effect.map((rows) =>
      rows.map(({ call_key: key, run_id: executionId, call, attributes, result }) => ({
        key,
        call,
        run: { executionId, attributes },
        result,
      })),
    ),
  );
}
