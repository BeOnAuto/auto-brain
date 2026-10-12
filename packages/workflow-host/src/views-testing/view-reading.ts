import type { ProgramPool } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';
import { expect, vi } from 'vitest';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import { reconciledRows } from '../projector/folder-pass.ts';
import { definitionsByType } from '../projector/projector-schedule.ts';
import { rowsOfBrain } from '../views/view-reconciling.ts';
import type { KeptView, ViewRow } from '../views/view-rows.ts';
import type { ViewsPort } from '../views/views-port.ts';
import { alpha, alphaKey, viewsFolderOver, viewTestTimeoutMs, type Brain } from './view-documents.ts';

export interface ViewReading {
  readonly viewOf: (name: string, brain?: Brain) => Promise<KeptView | undefined>;
  readonly until: (name: string, holds: (view: KeptView) => boolean, brain?: Brain) => Promise<KeptView>;
  readonly gone: (name: string) => Promise<boolean>;
}

export const viewWaiting = { timeout: viewTestTimeoutMs - 5000, interval: 20 };

export function viewReadingOf(views: ViewsPort): ViewReading {
  const viewOf: ViewReading['viewOf'] = (name, brain = alpha) => Effect.runPromise(views.viewOf(brain, name));
  return {
    viewOf,
    until: (name, holds, brain = alpha) =>
      vi.waitFor(async () => {
        const view = await viewOf(name, brain);
        if (view === undefined || !holds(view)) {
          throw new Error(`The view of ${name} does not hold yet: ${JSON.stringify(view)}`);
        }
        return view;
      }, viewWaiting),
    gone: (name) =>
      vi.waitFor(async () => {
        expect(await viewOf(name)).toBeUndefined();
        return true;
      }, viewWaiting),
  };
}

export function viewRowsOf(database: HostDatabase): Effect.Effect<readonly ViewRow[], DatabaseFailed> {
  return rowsOfBrain(database, alphaKey);
}

export function viewsReconciled(
  pool: ProgramPool,
  database: HostDatabase,
  rebuildsAtOnce: number,
): () => Promise<readonly ViewRow[]> {
  const kept = { database, rebuildsAtOnce, definitions: definitionsByType().of };
  const folder = viewsFolderOver(pool);
  return () => Effect.runPromise(reconciledRows(folder, kept, alphaKey));
}
