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
  type ProjectorSettings,
  type WorkflowStore,
} from '@beonauto/workflow-host';

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
        capability: makeRecallFunctionAdapter({ pool, views: store.views, mostFunctions: recall.mostFunctions }),
        store,
        projector: { folders, brainsAtOnce: recall.brainsAtOnce, pagesPerWake: recallBounds.pagesPerWake, appends },
      };
    },
  };
}
