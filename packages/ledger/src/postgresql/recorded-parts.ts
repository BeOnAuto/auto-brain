import { Schema } from 'effect';

import type { RecordedPoint } from '../event-store.ts';
import type { ExaminationScope, RecordHead } from '../recorded/recorded-statements.ts';

export type Query = (text: string, values: readonly unknown[]) => Promise<readonly unknown[]>;

export type Bind = (value: unknown) => string;

export const defaultPartition = 'emt:default';

const oldestWriteOfThisDatabase = `(
  SELECT coalesce(min(running.xid), pg_snapshot_xmax(pg_current_snapshot()))
  FROM pg_snapshot_xip(pg_current_snapshot()) AS running(xid)
  WHERE running.xid::text::bigint % 4294967296 NOT IN (
    SELECT backend_xid::text::bigint FROM pg_stat_activity
    WHERE backend_xid IS NOT NULL AND datname IS DISTINCT FROM current_database()
  )
)`;

const belowTheHorizon = `transaction_id < ${oldestWriteOfThisDatabase}`;

export const PointFields = { transaction: Schema.String, position: Schema.String };

const LineageFields = {
  id: Schema.String,
  causation: Schema.NullOr(Schema.String),
  correlation: Schema.NullOr(Schema.String),
};

export const HeadFields = {
  ...PointFields,
  ...LineageFields,
  stream: Schema.String,
  version: Schema.Int,
  type: Schema.String,
  recorded: Schema.String,
  size: Schema.Int,
};

export const lineageColumns = `message_id AS id, message_metadata ->> 'causationId' AS causation,
  message_metadata ->> 'correlationId' AS correlation`;

export function timeOf(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

export function binding(): { readonly values: readonly unknown[]; readonly bind: Bind } {
  const values: unknown[] = [];
  return {
    values,
    bind: (value) => {
      values.push(value);
      return `$${values.length}`;
    },
  };
}

export function direction({ order }: ExaminationScope): string {
  return order === 'asc' ? 'ASC' : 'DESC';
}

function pointAt(bind: Bind, [transaction, position]: RecordedPoint): string {
  return `(${bind(transaction)}::xid8, ${bind(position)}::bigint)`;
}

function beyond(bind: Bind, { order, after, at }: ExaminationScope): string {
  if (after !== undefined) {
    return ` AND (transaction_id, global_position) ${order === 'asc' ? '>' : '<'} ${pointAt(bind, after)}`;
  }
  return at === undefined
    ? ''
    : ` AND (transaction_id, global_position) ${order === 'asc' ? '>=' : '<='} ${pointAt(bind, at)}`;
}

export function bounds(bind: Bind, scope: ExaminationScope): string {
  const { from } = scope;
  const after = beyond(bind, scope);
  return from === undefined ? after : `${after} AND (transaction_id, global_position) >= ${pointAt(bind, from)}`;
}

export function horizonOf({ order }: ExaminationScope): string {
  return order === 'asc' ? ` AND ${belowTheHorizon}` : '';
}

export function matchedThroughItsIndex(bind: Bind, key: string, value: string): string {
  return `${key} = ANY(${bind([value])}::text[])`;
}

export function orderedThroughItsIndex(key: string, scope: ExaminationScope): string {
  return `${key} ${direction(scope)}, transaction_id ${direction(scope)}, global_position ${direction(scope)}`;
}

export function ofTypes(bind: Bind, column: string, types: readonly string[] | undefined): string {
  return types === undefined ? 'TRUE' : `${column} = ANY(${bind(types)}::text[])`;
}

interface Sized {
  readonly wanted: string;
  readonly types: string | undefined;
}

export function sizedTypesOf(bind: Bind, { sized }: ExaminationScope): string | undefined {
  return sized === undefined || sized.length === 0 ? undefined : bind(sized);
}

export function sizeOf({ wanted, types }: Sized, { sized }: ExaminationScope, message: string, type: string): string {
  if (sized === undefined) {
    return `CASE WHEN ${wanted} THEN octet_length(${message}.message_data ->> 'json') ELSE 0 END`;
  }
  return types === undefined
    ? '0'
    : `CASE WHEN ${wanted} AND ${type} = ANY(${types}::text[]) THEN octet_length(${message}.message_data ->> 'json') ELSE 0 END`;
}

interface HeadRow {
  readonly transaction: string;
  readonly position: string;
  readonly stream: string;
  readonly version: number;
  readonly type: string;
  readonly recorded: string;
  readonly id: string;
  readonly causation: string | null;
  readonly correlation: string | null;
  readonly size: number;
}

export function headOf({
  transaction,
  position,
  stream,
  version,
  type,
  recorded,
  id,
  causation,
  correlation,
  size,
}: HeadRow): RecordHead {
  return {
    point: [transaction, position],
    id,
    causationId: causation,
    correlationId: correlation,
    stream,
    version,
    type,
    recordedAt: recorded,
    size,
  };
}
