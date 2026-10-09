import type { RunOutcome, RunOutcomeMapping, RunOutcomeStatus } from '@beonauto/operations';
import { Option, Predicate, Schema } from 'effect';

const Time = Schema.String.check(
  Schema.makeFilter((at: string) => Number.isFinite(Date.parse(at)), { expected: 'a time' }),
);

const StartedSchema = Schema.Struct({
  type: Schema.Literal('run_started'),
  definition_type: Schema.String,
  name: Schema.String,
  at: Time,
});

const FinishedSchema = Schema.Struct({
  type: Schema.Literals(['run_succeeded', 'run_failed', 'run_rejected']),
  at: Time,
  record: Schema.optionalKey(Schema.Unknown),
});

type Started = typeof StartedSchema.Type;

type Finished = typeof FinishedSchema.Type;

const decodeRunEvent = Schema.decodeUnknownOption(Schema.Union([StartedSchema, FinishedSchema]));

const statusOf: Readonly<Record<Finished['type'], RunOutcomeStatus>> = {
  run_succeeded: 'succeeded',
  run_failed: 'failed',
  run_rejected: 'rejected',
};

const noTokens = { inputTokens: null, outputTokens: null, cachedTokens: null };

function dayOf(at: string): string {
  return new Date(Date.parse(at)).toISOString().slice(0, 10);
}

function countAt(record: unknown, path: readonly string[]): number | null {
  const found = path.reduce<unknown>(
    (value, key) => (Predicate.isObject(value) && Predicate.hasProperty(value, key) ? value[key] : undefined),
    record,
  );
  return typeof found === 'number' && Number.isSafeInteger(found) && found >= 0 ? found : null;
}

type Tokens = Pick<RunOutcome, 'inputTokens' | 'outputTokens' | 'cachedTokens'>;

function sumOf(kept: number | null, spent: number | null): number | null {
  if (kept === null || spent === null) {
    return kept ?? spent;
  }
  return kept + spent;
}

function tokensAfter(kept: Tokens, record: unknown): Tokens {
  return {
    inputTokens: sumOf(kept.inputTokens, countAt(record, ['usage', 'input', 'total'])),
    outputTokens: sumOf(kept.outputTokens, countAt(record, ['usage', 'output', 'total'])),
    cachedTokens: sumOf(kept.cachedTokens, countAt(record, ['usage', 'input', 'cache_read'])),
  };
}

function durationBetween(startedAt: string, finishedAt: string): number | null {
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isSafeInteger(duration) ? Math.max(0, duration) : null;
}

type Attempt = Pick<RunOutcome, 'lastStartedAt' | 'status' | 'durationMs'>;

function started(row: RunOutcome | undefined, { definition_type: type, name, at }: Started): RunOutcome {
  const again: Attempt = { lastStartedAt: at, status: 'started', durationMs: null };
  return row === undefined
    ? { startedDay: dayOf(at), startedAt: at, definitionType: type, name, ...again, ...noTokens }
    : { ...row, ...again };
}

function finished(row: RunOutcome | undefined, { type, at, record }: Finished): RunOutcome {
  const status = statusOf[type];
  if (row === undefined) {
    const notStarted = { startedDay: dayOf(at), startedAt: at, lastStartedAt: at, type: '', name: '' };
    return { ...notStarted, status, durationMs: null, ...tokensAfter(noTokens, record) };
  }
  const durationMs = status === 'rejected' ? null : durationBetween(row.lastStartedAt, at);
  return { ...row, status, durationMs, ...tokensAfter(row, record) };
}

export const runOutcomeMapping: RunOutcomeMapping = {
  types: ['run_started', 'run_succeeded', 'run_failed', 'run_rejected'],
  rowAfter: (row, event) =>
    Option.getOrUndefined(
      Option.map(decodeRunEvent(event), (decoded) =>
        decoded.type === 'run_started' ? started(row, decoded) : finished(row, decoded),
      ),
    ),
};
