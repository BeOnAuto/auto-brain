import type { AppRuntime } from '@beonauto/api';
import type { Capability } from '@beonauto/definitions';
import { appendSignal, type AppendSignal } from '@beonauto/ledger';
import type { DispatcherServices } from '@beonauto/operations';
import { makeRecallFunctionAdapter, recallBounds, recallDefinitionType, recallFolding } from '@beonauto/recall';
import type { ProgramPool } from '@beonauto/workflow-engine/dsl';
import {
  openWorkflowStore,
  someFolder,
  viewsFolder,
  viewsPortOn,
  type ProjectorSettings,
  type SomeFolder,
  type WorkflowStore,
} from '@beonauto/workflow-host';

import type { Settings } from '../settings/settings.ts';
import { hostDatabaseOf } from '../workflows/host-dependencies.ts';
import { hostReports } from '../workflows/host-reports.ts';

interface ServedProjections {
  readonly recall: Capability;
  readonly store: WorkflowStore;
  readonly projector: ProjectorSettings;
}

export interface ProjectionWiring {
  readonly appends: AppendSignal;
  readonly served: (
    runtime: AppRuntime<DispatcherServices>,
    settings: Settings,
    pool: ProgramPool,
    besides: readonly SomeFolder[],
  ) => Promise<ServedProjections>;
}

export function projectionWiring(): ProjectionWiring {
  const appends = appendSignal();
  return {
    appends,
    served: async (runtime, { ledger, recall }, pool, besides) => {
      const views = viewsFolder({
        definitionType: recallDefinitionType,
        pool,
        folding: recallFolding,
        overtimesBeforeStall: recallBounds.overtimesBeforeStall,
        rebuildsAtOnce: recall.rebuildsAtOnce,
      });
      const folders = [someFolder(views), ...besides];
      const store = await openWorkflowStore(hostDatabaseOf(ledger), hostReports(runtime).lostConnection, folders);
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
