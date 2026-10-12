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
  type ProjectorSettings,
  type WorkflowStore,
} from '@on.auto/workflow-host';

import type { Settings } from '../settings/settings.ts';
import { hostDatabaseOf } from '../workflows/host-dependencies.ts';
import { hostReports } from '../workflows/host-reports.ts';

interface ServedRecall {
  readonly capability: Capability;
  readonly store: WorkflowStore;
  readonly projector: ProjectorSettings;
}

export interface RecallWiring {
  readonly appends: AppendSignal;
  readonly served: (
    runtime: AppRuntime<DispatcherServices>,
    settings: Settings,
    pool: ProgramPool,
  ) => Promise<ServedRecall>;
}

export function recallWiring(): RecallWiring {
  const appends = appendSignal();
  return {
    appends,
    served: async (runtime, { ledger, recall }, pool) => {
      const views = viewsFolder({
        definitionType: recallDefinitionType,
        pool,
        folding: recallFolding,
        overtimesBeforeStall: recallBounds.overtimesBeforeStall,
        rebuildsAtOnce: recall.rebuildsAtOnce,
      });
      const folders = [someFolder(views)];
      const store = await openWorkflowStore(hostDatabaseOf(ledger), hostReports(runtime).lostConnection, folders);
      return {
        capability: makeRecallFunctionAdapter({
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
