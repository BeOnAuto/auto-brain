import { Effect, Schema } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import type { KeptFunction } from '../projector/brain-definitions.ts';
import type { FreshRow, Reconciled, Reconciling } from '../projector/folder.ts';
import { viewDetailsOf } from './view-details.ts';
import { viewRowOf, ViewRowSchema, type ViewRow } from './view-rows.ts';
import { brainsWithViews, viewAdded, viewRenewed, viewsOfBrain } from './view-statements.ts';

const BrainRow = Schema.Struct({ brain: Schema.String });

export function brainsWithViewsIn(database: HostDatabase): Effect.Effect<readonly string[], DatabaseFailed> {
  return Effect.map(rowsOf(BrainRow, database.read(brainsWithViews)), (rows) => rows.map(({ brain }) => brain));
}

export function rowsOfBrain(database: HostDatabase, brain: string): Effect.Effect<readonly ViewRow[], DatabaseFailed> {
  return rowsOf(ViewRowSchema, database.read(viewsOfBrain(brain))).pipe(
    Effect.map((rows) => rows.map((row) => viewRowOf(row))),
  );
}

function freshOf(brain: string, name: string, kept: KeptFunction, row: ViewRow | undefined): readonly FreshRow[] {
  const details = viewDetailsOf(kept.details);
  if (details === undefined || (row !== undefined && row.version >= kept.version)) {
    return [];
  }
  const { version, saved } = kept;
  const written = row === undefined ? viewAdded : viewRenewed;
  const view = { brain, name, version, saved, details: JSON.stringify(details), view: JSON.stringify(details.initial) };
  return [{ key: name, saved, added: (phase) => written({ ...view, phase }) }];
}

export function plannedViews({ brain, definitions }: Reconciling, rows: readonly ViewRow[]): Reconciled<ViewRow> {
  const { functions } = definitions;
  const byName = new Map(rows.map((row) => [row.name, row]));
  return {
    fresh: [...functions].flatMap(([name, kept]: readonly [string, KeptFunction]) =>
      freshOf(brain, name, kept, byName.get(name)),
    ),
    dropped: rows.filter(({ name }) => !functions.has(name)),
  };
}
