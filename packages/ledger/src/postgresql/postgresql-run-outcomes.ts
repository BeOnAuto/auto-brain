import type { RunOutcomeMapping, RunOutcomeSelection } from '@beonauto/operations';
import { Schema } from 'effect';

import type { RunOutcomesStore } from '../event-store.ts';
import { groupFields, groupOf } from '../outcomes/run-outcome-groups.ts';
import { runOutcomesTable } from '../outcomes/run-outcome-projection.ts';
import { keptOutcomesOnly } from '../outcomes/run-outcomes-reader.ts';
import { binding, type Bind, type Query } from './recorded-parts.ts';

const GroupRows = Schema.Array(Schema.Struct({ ...groupFields, durations: Schema.Array(Schema.Number) }));

function selected(bind: Bind, { primitive, name }: RunOutcomeSelection): string {
  const ofPrimitive = primitive === undefined ? '' : ` AND primitive = ${bind(primitive)}`;
  return name === undefined ? ofPrimitive : `${ofPrimitive} AND name = ${bind(name)}`;
}

export function postgresqlRunOutcomesReader(query: Query): RunOutcomesStore['readRunOutcomes'] {
  return async (brainKey, { from, to }, selection) => {
    const { values, bind } = binding();
    const rows = await query(
      `SELECT started_day AS day, primitive, name, status, count(*)::int AS runs,
          coalesce(sum(input_tokens), 0)::float8 AS input_tokens,
          coalesce(sum(output_tokens), 0)::float8 AS output_tokens,
          coalesce(sum(cached_tokens), 0)::float8 AS cached_tokens,
          coalesce(json_agg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), '[]'::json) AS durations
        FROM ${runOutcomesTable}
        WHERE brain_key = ${bind(brainKey)} AND started_day BETWEEN ${bind(from)} AND ${bind(to)}${selected(bind, selection)}
        GROUP BY started_day, primitive, name, status`,
      values,
    );
    return Schema.decodeUnknownSync(GroupRows)(rows).map((row) => groupOf(row));
  };
}

export function postgresqlRunOutcomesOf(
  runOutcomes: RunOutcomeMapping | undefined,
  query: Query,
): RunOutcomesStore['readRunOutcomes'] {
  return keptOutcomesOnly(runOutcomes, postgresqlRunOutcomesReader(query));
}
