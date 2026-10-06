import { Effect, Schema } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import type { HostNote } from '../host/host-reports.ts';
import { rowAfter, type ViewChange } from '../pages/view-changes.ts';
import type { ViewRow } from '../views/view-rows.ts';
import { foldedWritten } from '../views/view-statements.ts';

export interface ChangeWriting {
  readonly database: HostDatabase;
  readonly note: (note: HostNote) => Effect.Effect<void>;
}

export interface Pass {
  readonly rows: readonly ViewRow[];
  readonly pages: number;
}

interface Written {
  readonly change: ViewChange;
  readonly took: boolean;
}

const NameRow = Schema.Struct({ name: Schema.String });

function isNewlyStalled({ row, next }: ViewChange): boolean {
  return next.phase === 'stalled' && row.phase !== 'stalled';
}

function replaced(rows: readonly ViewRow[], kept: readonly ViewRow[], lost: readonly string[]): readonly ViewRow[] {
  const byName = new Map(kept.map((row) => [row.name, row]));
  return rows.filter(({ name }) => !lost.includes(name)).map((row) => byName.get(row.name) ?? row);
}

function writtenOne(parts: ChangeWriting, brain: string, change: ViewChange): Effect.Effect<Written, DatabaseFailed> {
  const { row } = change;
  return rowsOf(NameRow, parts.database.write(foldedWritten(row, change.next))).pipe(
    Effect.map((rows): Written => ({ change, took: rows.length > 0 })),
    Effect.tap(({ took }) =>
      took && isNewlyStalled(change)
        ? parts.note({ kind: 'view_stalled', brain, name: row.name, version: row.version })
        : Effect.void,
    ),
  );
}

export function applied(
  parts: ChangeWriting,
  brain: string,
  pass: Pass,
  changes: readonly ViewChange[],
): Effect.Effect<Pass, DatabaseFailed> {
  return Effect.forEach(changes, (change) => writtenOne(parts, brain, change)).pipe(
    Effect.map((outcomes: readonly Written[]): Pass => ({
      rows: replaced(
        pass.rows,
        outcomes.filter(({ took }) => took).map(({ change }) => rowAfter(change)),
        outcomes.filter(({ took }) => !took).map(({ change }) => change.row.name),
      ),
      pages: pass.pages,
    })),
  );
}
