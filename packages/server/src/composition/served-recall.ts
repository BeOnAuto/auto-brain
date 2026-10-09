import type { AppRuntime } from '@beonauto/api';
import type { Capability } from '@beonauto/definitions';
import { appendSignal, type AppendSignal } from '@beonauto/ledger';
import type { DispatcherServices } from '@beonauto/operations';
import { makeRecallFunctionAdapter, recallBounds, recallDefinitionType, recallFolding } from '@beonauto/recall';
import type { ProgramPool } from '@beonauto/workflow-engine/dsl';
import { openWorkflowStore, type ProjectorSettings, type WorkflowStore } from '@beonauto/workflow-host';

import type { Settings } from '../settings/settings.ts';
import { hostDatabaseOf } from '../workflows/host-dependencies.ts';
import { hostReports } from '../workflows/host-reports.ts';

interface ServedRecall {
  readonly capability: Capability;
  readonly store: WorkflowStore;
  readonly views: ProjectorSettings;
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
      const store = await openWorkflowStore(hostDatabaseOf(ledger), hostReports(runtime).lostConnection);
      return {
        capability: makeRecallFunctionAdapter({ pool, views: store.views, mostFunctions: recall.mostFunctions }),
        store,
        views: {
          definitionType: recallDefinitionType,
          pool,
          folding: recallFolding,
          brainsAtOnce: recall.brainsAtOnce,
          rebuildsAtOnce: recall.rebuildsAtOnce,
          pagesPerWake: recallBounds.pagesPerWake,
          overtimesBeforeStall: recallBounds.overtimesBeforeStall,
          appends,
        },
      };
    },
  };
}
