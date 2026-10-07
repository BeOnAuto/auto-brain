import type { RunOutcomeMapping, RunOutcomeSelection } from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { RunOutcomesStore, StatementExecutor } from '../event-store.ts';
import { groupFields, groupOf } from './run-outcome-groups.ts';
import { runOutcomesTable } from './run-outcome-projection.ts';
import { keptOutcomesOnly } from './run-outcomes-reader.ts';

const table = SQL.plain(runOutcomesTable);

const GroupRows = Schema.Array(
  Schema.Struct({ ...groupFields, durations: Schema.fromJsonString(Schema.Array(Schema.Number)) }),
);

function selected({ primitive, name }: RunOutcomeSelection): SQL {
  return SQL.concat(
    primitive === undefined ? SQL.EMPTY : SQL` AND primitive = ${primitive}`,
    name === undefined ? SQL.EMPTY : SQL` AND name = ${name}`,
  );
}

export function sqliteRunOutcomesReader(execute: StatementExecutor): RunOutcomesStore['readRunOutcomes'] {
  return async (brainKey, { from, to }, selection) => {
    const { rows } = await execute.query(
      SQL`SELECT started_day AS day, primitive, name, status, count(*) AS runs,
          coalesce(sum(input_tokens), 0) AS input_tokens, coalesce(sum(output_tokens), 0) AS output_tokens,
          coalesce(sum(cached_tokens), 0) AS cached_tokens,
          json_group_array(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS durations
        FROM ${table}
        WHERE brain_key = ${brainKey} AND started_day BETWEEN ${from} AND ${to}${selected(selection)}
        GROUP BY started_day, primitive, name, status`,
    );
    return Schema.decodeUnknownSync(GroupRows)(rows).map((row) => groupOf(row));
  };
}

export function sqliteRunOutcomesOf(
  runOutcomes: RunOutcomeMapping | undefined,
  execute: StatementExecutor,
): RunOutcomesStore['readRunOutcomes'] {
  return keptOutcomesOnly(runOutcomes, sqliteRunOutcomesReader(execute));
}
