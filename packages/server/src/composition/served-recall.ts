import type { AppRuntime } from '@beonauto/api';
import { appendSignal, type AppendSignal } from '@beonauto/ledger';
import type { DispatcherServices } from '@beonauto/operations';
import { makeRecallFunctionAdapter, recallBounds, recallDefinitionType, recallFolding } from '@beonauto/recollection';
import type { Primitive } from '@beonauto/specs';
import type { ProgramPool } from '@beonauto/workflow-engine/dsl';
import { openWorkflowStore, type ProjectorSettings, type WorkflowStore } from '@beonauto/workflow-host';

import type { Settings } from '../settings/settings.ts';
import { hostDatabaseOf, hostReports } from '../workflows/host-dependencies.ts';

interface ServedRecall {
  readonly primitive: Primitive;
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
        primitive: makeRecallFunctionAdapter({ pool, views: store.views, mostFunctions: recall.mostFunctions }),
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
