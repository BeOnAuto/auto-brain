import type { AppRuntime } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import type { DispatcherServices, HttpRegistration } from '@on.auto/operations';
import { datasetFolder, datasetsPortOn, makePredictionFunctionAdapter, uploadDataset } from '@on.auto/prediction';
import { recallBounds } from '@on.auto/recall';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { someFolder, type SomeFolder, type WorkflowStore } from '@on.auto/workflow-host';

import type { PredictionSettings } from '../function-settings/prediction-settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';
import { predictionServedBy, type ServedPrediction } from './served-prediction.ts';

interface PlaybookRoute {
  readonly registration: HttpRegistration<'playbook'>;
}

export interface ServedPredictionFunctions extends ServedPrediction {
  readonly capability: Capability;
  readonly routes: readonly PlaybookRoute[];
}

export function datasetsFolderOf(pool: ProgramPool): SomeFolder {
  return someFolder(
    datasetFolder({ filters: pool.evaluations.filters, triesBeforeStall: recallBounds.overtimesBeforeStall }),
  );
}

export async function predictionFunctionsServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: PredictionSettings,
  pool: ProgramPool,
  store: WorkflowStore,
): Promise<ServedPredictionFunctions> {
  const { processes, withProcessesClosed } = await predictionServedBy(runtime, settings);
  return {
    processes,
    withProcessesClosed,
    capability: makePredictionFunctionAdapter({
      pool,
      datasets: datasetsPortOn(store.database),
      mostFunctions: settings.mostFunctions,
    }),
    routes: [uploadDataset(runtimeLedger(runtime).content)],
  };
}
