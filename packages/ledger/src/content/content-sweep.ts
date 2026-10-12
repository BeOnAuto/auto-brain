import { SQL } from '@event-driven-io/dumbo';
import { Clock, Effect, type Scope } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { shelves, type Shelf } from './content-tables.ts';

export const unnamedChunksLastMs = 3_600_000;

export interface ContentSweeping {
  readonly sweepContent: (before: number) => Promise<void>;
}

function uploadTimeOf(at: number): string {
  return at.toString(16).padStart(12, '0');
}

function sweptShelf(
  execute: StatementExecutor,
  { chunks, heads, placeColumns }: Shelf,
  before: string,
): Promise<unknown> {
  const sameUpload = SQL.merge(
    [...placeColumns, 'upload_id'].map(
      (column) =>
        SQL`${SQL.identifier(heads)}.${SQL.identifier(column)} = ${SQL.identifier(chunks)}.${SQL.identifier(column)}`,
    ),
    ' AND ',
  );
  return execute.command(
    SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE substr(upload_id, 1, 8) || substr(upload_id, 10, 4) < ${before}
      AND NOT EXISTS (SELECT 1 FROM ${SQL.identifier(heads)} WHERE ${sameUpload})`,
  );
}

export function contentSweepOn(execute: StatementExecutor): ContentSweeping['sweepContent'] {
  return (before) => inTurn(shelves, (shelf) => sweptShelf(execute, shelf, uploadTimeOf(before)));
}

function sweptNow({ sweepContent }: ContentSweeping): Effect.Effect<void> {
  return Effect.uninterruptible(
    Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.promise(() => sweepContent(now - unnamedChunksLastMs))),
  );
}

export function sweptHourly(store: ContentSweeping): Effect.Effect<void, never, Scope.Scope> {
  const sweep = Effect.catchCause(sweptNow(store), (cause) =>
    Effect.logError(
      'The ledger could not sweep what puts that never finished left of their content; it sweeps again in an hour',
      cause,
    ),
  );
  return Effect.asVoid(Effect.forkScoped(Effect.forever(Effect.andThen(sweep, Effect.sleep('1 hour')))));
}
