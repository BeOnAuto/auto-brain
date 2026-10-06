import { randomBytes } from 'node:crypto';

interface Row {
  readonly stream: string;
  readonly position: number;
  readonly type: string;
  readonly data: string;
  readonly metadata: string;
}

const largeEvery = 200;

export const longRunId = 'long-running';

export const longRun = `brain/o1/big/runs/${longRunId}`;

const statuses: readonly (readonly [number, number, string])[] = [
  [largeEvery, 13, 'succeeded'],
  [100, 7, 'failed'],
  [20, 5, 'rejected'],
  [25, 3, 'deferred'],
  [33, 1, 'running'],
];

function statusOf(run: number): string {
  return statuses.find(([every, at]) => run % every === at)?.[2] ?? 'succeeded';
}

function text(characters: number): string {
  return randomBytes(characters / 2).toString('hex');
}

export function timeOf(second: number): string {
  return new Date(Date.UTC(2026, 0, 1) + second * 1000).toISOString();
}

export function runIdOf(run: number): string {
  return String(run).padStart(8, '0');
}

export function executions(run: number): string {
  return `brain/o1/big/executions/${runIdOf(run)}`;
}

function metadataOf(correlation: string | undefined): string {
  return correlation === undefined ? '{}' : JSON.stringify({ correlationId: correlation });
}

function row(
  stream: string,
  position: number,
  data: { readonly type: string; readonly [field: string]: unknown },
  correlation?: string,
): Row {
  return { stream, position, type: data.type, data: JSON.stringify(data), metadata: metadataOf(correlation) };
}

function finishOf(run: number, at: string): readonly Row[] {
  const status = statusOf(run);
  const facts: Readonly<Record<string, object>> = {
    failed: {},
    rejected: { rejection: { reason: 'unavailable', detail: 'try again later' } },
    deferred: { record: {} },
    succeeded: { output: { text: text(run % largeEvery === 13 ? 1_048_576 : 640) }, record: {} },
  };
  const finished = { type: `execution_${status}`, ...facts[status], by: 'user-1', at };
  return run < 0 || status === 'running' ? [] : [row(executions(run), 2, finished, runIdOf(run))];
}

export function tick(t: number): readonly Row[] {
  const at = timeOf(t);
  const input = { text: text(t % largeEvery === 13 ? 262_144 : 320) };
  const start = { type: 'execution_started', primitive: 'inference', name: `spec-${t % 50}`, spec_version: 1, input };
  const inputs = Array.from({ length: t % 10 === 0 ? 20 : 0 }, (_, index) =>
    row(`brain/o1/big/runs/${runIdOf(t)}`, index + 1, { type: 'input_applied', patch: text(2048) }, runIdOf(t)),
  );
  const others = Array.from({ length: 7 }, (_, index) =>
    row(`brain/o2/other-${t % 99}/executions/${t}-${index}`, 1, { type: 'execution_started', input: text(512) }),
  );
  const started = row(executions(t), 1, { ...start, by: 'user-1', at }, runIdOf(t));
  const longStart =
    t === 0 ? [{ ...started, stream: `brain/o1/big/executions/${longRunId}`, metadata: metadataOf(longRunId) }] : [];
  return [
    started,
    ...finishOf(t - 1, at),
    ...inputs,
    ...others,
    ...longStart,
    row(longRun, t + 1, { type: 'input_applied' }, longRunId),
  ];
}

export const othersInSQLite = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000000)
  INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata,
    message_schema_version, message_type, message_id)
  SELECT 'brain/o3/other-' || (i % 50) || '/executions/' || i, 1, 'emt:default', '{"type":"execution_started"}', '{}',
    '1', 'execution_started', 'later-' || i FROM n`;

export const othersInPostgreSQL = `INSERT INTO emt_messages (stream_id, stream_position, message_data, message_metadata,
    message_schema_version, message_type, message_id, transaction_id)
  SELECT 'brain/o3/other-' || (i % 50) || '/executions/' || i, 1, jsonb_build_object('json', '{"type":"execution_started"}'),
    '{}', '1', 'execution_started', 'later-' || i, pg_current_xact_id()
  FROM generate_series(1, 1000000) AS i`;
