import {
  RunOutcomeStatusSchema,
  type ProjectedRow,
  type RunOutcome,
  type RunOutcomeMapping,
  type RunProjection,
} from '@beonauto/operations';
import { Schema } from 'effect';

export const runOutcomesVersion = 1;

export const runOutcomesTable = `run_outcomes_${runOutcomesVersion}`;

const KeptOutcomeSchema = Schema.Struct({
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

const decodeKept = Schema.decodeUnknownSync(KeptOutcomeSchema);

function outcomeOf(row: ProjectedRow): RunOutcome {
  const kept = decodeKept(row);
  return {
    startedDay: kept.started_day,
    startedAt: kept.started_at,
    lastStartedAt: kept.last_started_at,
    primitive: kept.primitive,
    name: kept.name,
    status: kept.status,
    durationMs: kept.duration_ms,
    inputTokens: kept.input_tokens,
    outputTokens: kept.output_tokens,
    cachedTokens: kept.cached_tokens,
  };
}

function rowOf(outcome: RunOutcome): ProjectedRow {
  return {
    started_day: outcome.startedDay,
    started_at: outcome.startedAt,
    last_started_at: outcome.lastStartedAt,
    primitive: outcome.primitive,
    name: outcome.name,
    status: outcome.status,
    duration_ms: outcome.durationMs,
    input_tokens: outcome.inputTokens,
    output_tokens: outcome.outputTokens,
    cached_tokens: outcome.cachedTokens,
  };
}

export function runOutcomeProjectionOf({ types, rowAfter }: RunOutcomeMapping): RunProjection {
  return {
    name: 'run_outcomes',
    version: runOutcomesVersion,
    types,
    columns: [
      { name: 'started_day', kind: 'text' },
      { name: 'started_at', kind: 'text' },
      { name: 'last_started_at', kind: 'text' },
      { name: 'primitive', kind: 'text' },
      { name: 'name', kind: 'text' },
      { name: 'status', kind: 'text' },
      { name: 'duration_ms', kind: 'integer' },
      { name: 'input_tokens', kind: 'integer' },
      { name: 'output_tokens', kind: 'integer' },
      { name: 'cached_tokens', kind: 'integer' },
    ],
    indexes: [{ name: 'by_brain_and_day', columns: ['started_day'] }],
    rowAfter: (row, event) => {
      const outcome = rowAfter(row === undefined ? undefined : outcomeOf(row), event);
      return outcome === undefined ? undefined : rowOf(outcome);
    },
  };
}

export function keptProjections(
  runOutcomes: RunOutcomeMapping | undefined,
  projections: readonly RunProjection[],
): readonly RunProjection[] {
  return [...(runOutcomes === undefined ? [] : [runOutcomeProjectionOf(runOutcomes)]), ...projections];
}
