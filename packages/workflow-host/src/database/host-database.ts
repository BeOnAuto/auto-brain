import type { EventStore } from '@beonauto/ledger';
import { Data, Effect, Schema } from 'effect';

import type { Statement } from './statement.ts';

export class DatabaseFailed extends Data.TaggedError('database_failed')<{ readonly detail: string }> {}

export interface HostDatabase {
  readonly store: EventStore;
  readonly read: (statement: Statement) => Effect.Effect<readonly unknown[], DatabaseFailed>;
  readonly write: (statement: Statement) => Effect.Effect<readonly unknown[], DatabaseFailed>;
  readonly sharedClock: Effect.Effect<number, DatabaseFailed> | null;
  readonly close: () => Promise<void>;
}

export const WholeNumber = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

export function failedWith(error: unknown): DatabaseFailed {
  return new DatabaseFailed({ detail: String(error) });
}

export function rowsOf<Row>(
  rowSchema: Schema.Codec<Row, unknown>,
  rows: Effect.Effect<readonly unknown[], DatabaseFailed>,
): Effect.Effect<readonly Row[], DatabaseFailed> {
  const decode = Schema.decodeUnknownEffect(Schema.Array(rowSchema));
  return Effect.flatMap(rows, (found) => Effect.orDie(decode(found)));
}

export function oneRowOf<Row>(
  rowSchema: Schema.Codec<Row, unknown>,
  rows: Effect.Effect<readonly unknown[], DatabaseFailed>,
): Effect.Effect<Row, DatabaseFailed> {
  const decode = Schema.decodeUnknownEffect(Schema.Tuple([rowSchema]));
  return Effect.flatMap(rows, (found) => Effect.orDie(decode(found))).pipe(Effect.map(([row]) => row));
}
