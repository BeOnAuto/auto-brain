import type { AppRuntime } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import { appendSignal, type AppendSignal } from '@on.auto/ledger';
import type { DispatcherServices } from '@on.auto/operations';
import { makeRecallFunctionAdapter, recallBounds, recallDefinitionType, recallFolding } from '@on.auto/recall';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import {
  openWorkflowStore,
  someFolder,
  viewsFolder,
  viewsPortOn,
  type DatabaseSettings,
  type ProjectorSettings,
  type SomeFolder,
  type WorkflowStore,
} from '@on.auto/workflow-host';

import type { Settings } from '../settings/settings.ts';
import { hostReports } from '../workflows/host-reports.ts';

interface ServedProjections {
  readonly recall: Capability;
  readonly store: WorkflowStore;
  readonly projector: ProjectorSettings;
}

interface ProjectedOn extends Pick<Settings, 'recall'> {
  readonly database: DatabaseSettings;
}

export interface ProjectionWiring {
  readonly appends: AppendSignal;
  readonly served: (
    runtime: AppRuntime<DispatcherServices>,
    on: ProjectedOn,
    pool: ProgramPool,
    besides: readonly SomeFolder[],
  ) => Promise<ServedProjections>;
}

export function projectionWiring(): ProjectionWiring {
  const appends = appendSignal();
  return {
    appends,
    served: async (runtime, { recall, database }, pool, besides) => {
      const views = viewsFolder({
        definitionType: recallDefinitionType,
        pool,
        folding: recallFolding,
        overtimesBeforeStall: recallBounds.overtimesBeforeStall,
        rebuildsAtOnce: recall.rebuildsAtOnce,
      });
      const folders = [someFolder(views), ...besides];
      const store = await openWorkflowStore(database, hostReports(runtime).lostConnection, folders);
      return {
        recall: makeRecallFunctionAdapter({
          pool,
          views: viewsPortOn(store.database),
          mostFunctions: recall.mostFunctions,
        }),
        store,
        projector: {
          folders,
          playbooksAtOnce: recall.playbooksAtOnce,
          pagesPerWake: recallBounds.pagesPerWake,
          appends,
        },
      };
    },
  };
}
